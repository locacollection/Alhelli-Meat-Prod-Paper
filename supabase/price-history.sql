-- Price history for Barcode Learning (each rate is a separate immutable training version).
-- Existing examples keep their original profile_id. Only the new version receives fresh labels.
BEGIN;

ALTER TABLE public.barcode_learning_profiles
  ADD COLUMN IF NOT EXISTS price_series_id uuid,
  ADD COLUMN IF NOT EXISTS price_version integer,
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;

-- For existing profiles, use their stable ID as the price-series identity.
UPDATE public.barcode_learning_profiles
  SET price_series_id = COALESCE(price_series_id, id),
      price_version = COALESCE(price_version, 1)
WHERE price_series_id IS NULL OR price_version IS NULL;

ALTER TABLE public.barcode_learning_profiles
  ALTER COLUMN price_series_id SET DEFAULT gen_random_uuid(),
  ALTER COLUMN price_series_id SET NOT NULL,
  ALTER COLUMN price_version SET DEFAULT 1,
  ALTER COLUMN price_version SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS barcode_learning_one_active_price_version
  ON public.barcode_learning_profiles (owner_id, price_series_id)
  WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS barcode_learning_price_history_idx
  ON public.barcode_learning_profiles (owner_id, price_series_id, price_version DESC);

-- Restrict fresh examples to active versions. Historic training labels remain readable.
ALTER POLICY "Owners add own barcode learning examples"
  ON public.barcode_learning_examples
  WITH CHECK (
    owner_id = (SELECT auth.uid()) AND
    EXISTS (
      SELECT 1 FROM public.barcode_learning_profiles p
      WHERE p.id = profile_id
        AND p.owner_id = owner_id
        AND p.archived_at IS NULL
    )
  );

CREATE OR REPLACE FUNCTION public.start_barcode_learning_price_version(
  p_profile_id uuid,
  p_new_unit_price_fils integer,
  p_expected_unit_price_fils integer
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  current_profile public.barcode_learning_profiles%ROWTYPE;
  new_profile_id uuid;
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'Sign in to change a price.';
  END IF;

  SELECT * INTO current_profile
  FROM public.barcode_learning_profiles
  WHERE id = p_profile_id
    AND owner_id = (SELECT auth.uid())
    AND archived_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'This price profile is no longer active. Refresh and select the current version.';
  END IF;
  IF p_new_unit_price_fils IS NULL OR
     p_new_unit_price_fils < 1 OR p_new_unit_price_fils > 999999 THEN
    RAISE EXCEPTION 'The new price must be between 0.001 and 999.999 BD/kg.';
  END IF;
  IF p_expected_unit_price_fils IS DISTINCT FROM current_profile.unit_price_fils THEN
    RAISE EXCEPTION 'The unit price changed since this page loaded. Refresh before changing it.';
  END IF;
  IF current_profile.unit_price_fils = p_new_unit_price_fils THEN
    RAISE EXCEPTION 'Enter a different unit price.';
  END IF;

  -- This original row and all of its confirmed samples remain stored as historical data.
  UPDATE public.barcode_learning_profiles
  SET archived_at = now(), updated_at = now()
  WHERE id = current_profile.id AND owner_id = (SELECT auth.uid());

  -- New version starts unvalidated. Its previous encoding format can be consulted
  -- in history, but cannot be used to predict until new labels validate it.
  INSERT INTO public.barcode_learning_profiles (
    owner_id, item_code, product_name, weight_step_grams,
    unit_price_fils, rounding_fils, price_series_id, price_version,
    barcode_prefix, pattern_mode, review_status, sample_count
  )
  VALUES (
    current_profile.owner_id, current_profile.item_code, current_profile.product_name,
    current_profile.weight_step_grams, p_new_unit_price_fils,
    current_profile.rounding_fils, current_profile.price_series_id,
    current_profile.price_version + 1,
    '', 'unknown', 'collecting', 0
  )
  RETURNING id INTO new_profile_id;

  RETURN new_profile_id;
END
$function$;

REVOKE ALL ON FUNCTION public.start_barcode_learning_price_version(uuid,integer,integer)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.start_barcode_learning_price_version(uuid,integer,integer)
  TO authenticated;

COMMIT;
