# Atlas seed data

Everything the web app used to bundle as demo data, as data. `npm run seed`
loads it into the Atlas table (DynamoDB) and the Atlas bucket (S3); the app
reads it from there through `/api/atlas/*`, `/api/journey/*` and
`/api/mrv/dataset`. Nothing here is imported by the app.

| File | Goes to | What it is |
| --- | --- | --- |
| `catalog/tenants.json` | table `CATALOG / TENANT#<id>` | the four demo tenants |
| `catalog/projects.json` | table `CATALOG / PROJECT#<tenant>#<id>` | the eleven demo projects |
| `journey/scenarios.json` | table `SCENARIO / SCENARIO#<id>` | practice journeys' starting points |
| `site-models/<tenant>/<project>/v<n>/…` | bucket, same path; table `PROJECT#<id> / SITEMODEL#…` | a project's 3D site model: `manifest.json`, `layout.json`, `assets/` |
| `mrv/<tenant>/<registry>/<project>.json` | bucket, same path | a project's seeded monitoring history (days, lab values, registry blocks) |

Key layout: `src/lib/atlas/keys.ts`.

## Run it

```sh
npm run backend:up   # DynamoDB on :8100, S3 (LocalStack) on :4566 — apps/web/local
npm run seed         # loads this folder; safe to run again
```

`.env.local` needs `ATLAS_TABLE`, `ATLAS_BUCKET`, `ATLAS_DYNAMODB_ENDPOINT` and
`ATLAS_S3_ENDPOINT` (see `.env.example`). LocalStack keeps nothing between
starts, so run the seed after each `backend:up`; the table keeps its data in a
Docker volume.

For an AWS stage, set `ATLAS_TABLE` and `ATLAS_BUCKET` to that stage's names
(the data stack outputs), leave the endpoints unset and run
`npm run seed -- --target=aws`. Without `--target=aws` the loader refuses to
touch AWS.

## Change it

The files are written by `npm run seed:export` from the sources in
`scripts/seed/sources/` (the TypeScript the app used to bundle). Edit a
source, export, commit both, then seed. The MRV histories are generated from
today's date when exported, so export again to move them forward.

## 3D site models

Each version is a folder that is never changed once published:

- `manifest.json` lists the layout and every asset with its SHA-256 and size.
- `layout.json` is the scene: objects, flows, supply chains, subsurface.
- `assets/` holds binary files: today the drone photo the model was traced
  from; glTF meshes (`.glb`, Draco or Meshopt compressed) and KTX2 textures go
  here too.

Publishing a new version means writing a new `v<n+1>/` folder and then moving
the table's `SITEMODEL#CURRENT` pointer, so nobody ever sees half a model. Old
versions stay for audit. The browser gets the layout from
`/api/atlas/projects/<id>/site-model` and each asset from
`…/site-model/assets/v<n>/<key>`, which only serves files the live manifest
lists and lets the browser cache them for good (a new version has a new URL).
