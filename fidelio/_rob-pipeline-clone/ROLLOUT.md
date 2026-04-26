# Fidelio Pipeline — Rollout Notes

## Where We Are

The Dre Alexandra local build is now close to editor-ready. Core ingest, export, review, thumbnail, Sheets, and Blotato scheduling are all working end to end.

## Next 48 Hours

1. Add the repo to GitHub
2. Freeze install/setup for non-technical editors
3. Test a clean install on two separate editor machines

## Editor Install Shape

Each editor should only need:

- the repo
- `bash setup.sh`
- a filled `.env`
- Google service account credentials
- local watch folder paths in the client JSON
- Blotato workspace/platforms already connected

## Onboarding Checklist

1. Clone repo and run setup
2. Fill `.env`
3. Confirm Google Sheets access
4. Start daemon with `python local/start.py --client <id>`
5. Verify Monitor at `localhost:5401`
6. Verify Review UI at `localhost:5400/review/<id>`
7. Run one ingest smoke test and one export smoke test

## Known Packaging Direction

The app is already wrapped for desktop use, but the immediate priority is a reliable install path first. Packaging should come after the GitHub push and editor onboarding checklist are stable.
