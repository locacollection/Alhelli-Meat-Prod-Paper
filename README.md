# Meat Production - GitHub Pages and Supabase setup

This is a simple 6777 → 6780 / 6781 meat-conversion worksheet. It is NOT a stock or POS system.

## Work process
- Weigh each original 6777 beef-with-bone portion before processing.
- Record the resulting 6780 minced and/or 6781 boneless weight after processing.
- Bones/trimming = original 6777 - 6780 - 6781.
- If nothing is converted, no Recipe Issue/GRN paper is created.
- Save locally in the browser, export CSV, or print an A4 paper with spaces for attaching original scale labels.

## Supabase
The **publishable** (browser-safe) API key and project URL are present in \`index.html\`. Do not put service_role or secret API keys in this repository.

The Supabase integration is OPTIONAL and cloud saving is never automatic.

1. Open the Supabase dashboard for project \`tvaqcbzmzpyltbbelwbw\`.
2. Open **SQL Editor**. Run \`supabase/schema.sql\`. This sets up private, user-owned \`production_papers\` with Row Level Security (RLS). Until then, cloud save will show an error.
3. Open **Authentication > Users** and create/invite an authorized email user. Keep public sign-ups disabled if only approved staff should use cloud storage.
4. Sign in using the website's Cloud Save area.
5. Choose **Save current paper** to upload intentionally. Use **Refresh saved papers** and **Load selected paper** to retrieve it.
6. Ensure your workplace authorizes cloud storage of production weights and staff details.

### Security
- Anonymous visitors cannot read or write saved production papers.
- Signed-in users can access only papers owned by their user ID, enforced in the database.
- The site's code is public on GitHub Pages. The publishable key alone does not grant database permissions.
- No photos are uploaded to Supabase, and the browser's local records are not synchronized automatically.
- Do not put privileged keys, customer details or company records into the GitHub repository.

## GitHub Pages
In the repository, go to **Settings > Pages > Build and deployment**, choose **Deploy from a branch**, select \`main\` and \`/(root)\`, and save.

The resulting Pages URL is expected to be:
https://locacollection.github.io/Alhelli-Meat-Prod-Paper/

This address is only live once GitHub Pages has been enabled and the deployment completed.
