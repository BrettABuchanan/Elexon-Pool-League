# ELEXON Pool League

This dashboard works locally straight away. To save scores online and use it from the web, connect it to Supabase and deploy it to Netlify.

## 1. Create the database

1. Go to Supabase and create a free project.
2. Open SQL Editor.
3. Paste in the contents of `supabase-schema.sql`.
4. Run it.

## 2. Add Supabase details

1. In Supabase, open Project Settings, then API.
2. Copy the Project URL.
3. Copy the anon public key.
4. Paste both into `config.js`.

## 3. Put it online

1. Go to Netlify.
2. Add a new site.
3. Drag this folder into Netlify, or connect it through GitHub.
4. Netlify will publish the static files and give you a web link.

## Note

This simple version lets anyone with the link edit the scores. Add login or a password gate before sharing widely.
