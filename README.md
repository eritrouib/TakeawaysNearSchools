# Takeaways Near Schools

Many councils refuse new hot-food takeaways within a set distance of schools, often 400 m, to tackle childhood obesity. This tool shows, for any council in England:

- every open school, with a zone of your chosen size around it (200 m to 800 m)
- every takeaway, coloured by whether it's inside a zone
- how many takeaways are within the distance, how many schools have at least one nearby, and which schools have the most
- **Check a site**: enter an address (or click the map) to see if it's inside a zone and which schools it's near: useful when looking at a planning application for a new takeaway

You choose which schools count (primary, secondary, special, nursery, sixth form…), since council policies differ. Results download as CSV.

**Live site:** https://eritrouib.github.io/TakeawaysNearSchools/ (once GitHub Pages is enabled)

## Data

| What | Source |
|---|---|
| Schools | Department for Education *Get Information about Schools*, via [planning.data.gov.uk](https://www.planning.data.gov.uk) (dataset `educational-establishment`), loaded live |
| Takeaways | Food Standards Agency [food hygiene rating open data](https://ratings.food.gov.uk/open-data), businesses registered as "Takeaway/sandwich shop" (7844), plus "Restaurant/Cafe/Canteen" (1) whose names suggest hot food (chicken, kebab, pizza, fish & chips…), rebuilt weekly |
| Council boundaries | planning.data.gov.uk |

`scripts/build_takeaways.py` (Python 3, no extra packages) downloads each English authority's daily FSA file and keeps takeaways with a location. A GitHub Action (`.github/workflows/update.yml`) runs it every Tuesday.

### First run

1. Push to GitHub and enable Pages (Settings → Pages → Deploy from branch → `main`, `/ (root)`).
2. Settings → Actions → General → Workflow permissions → **Read and write permissions**.
3. Actions → **Update takeaways** → **Run workflow** (about 10 to 20 minutes).

Until then, schools, zones and site checks work; takeaway counts appear once the data is built. To build one council locally: `python scripts/build_takeaways.py --only 521` (521 = Kingston upon Thames; codes are in the FSA authority list).

## Things to know

- **Straight-line distances.** Policies often use walking distance, which is longer, so this shows the widest possible zone.
- **School phase is inferred.** The national school records on Planning Data don't include phase, so it's worked out from the school type and name. Schools it can't classify are shown as "phase unclear" (included by default). Colleges and universities are left out.
- **Schools just across the council boundary** aren't included, even though their zones can reach into the council.
- **"Takeaway/sandwich shop"** in food hygiene data isn't the same as the planning use class for hot-food takeaways: it includes sandwich shops and some cafés. Many hot-food takeaways are registered as restaurants, so the page also counts restaurants and cafés with takeaway-style names (you can switch this off). That name test will miss some and catch the odd sit-down pizza restaurant. Takeaways in neighbouring councils are included when they're close to a school.
- Check your council's local plan for its actual policy (distance, which schools, walking or straight line).

## Development

```
npm test   # JavaScript (Node) and Python tests
```

The page fetches its data files, so serve the folder (`python -m http.server`) rather than opening `index.html` directly.

## Licence & attribution

Created by **@ET**.

Contains public sector information licensed under the Open Government Licence v3.0: Food Standards Agency food hygiene rating data; Department for Education Get Information about Schools, via planning.data.gov.uk. Basemap © Esri.
