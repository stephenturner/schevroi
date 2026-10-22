# Data

`schev_roi_all_institutions.csv` holds SCHEV's program-level return on investment estimates for Virginia four-year colleges, copied from the [College Outcomes ROI dashboard](https://collegeoutcomes.schev.edu/rdPage.aspx?rdReport=ROI.ROI_Dashboard) in October 2026 with Claude in Chrome, one institution at a time.

The file has 726 rows, one per institution and six-digit CIP code, covering 39 institutions and 200 programs. The dashboard lists 49 institutions, and I haven't checked why 10 are missing. Private schools such as Liberty and Roanoke are included.

| Column | Example | Notes |
| --- | --- | --- |
| `Institution` | Christopher Newport University | |
| `CIP` | 260101 | Program code, stored as text. |
| `Program` | Biology/Biological Sciences, General | CIP title. |
| `Pct Graduates with Wage Data` | 51% | Share of graduates matched to Virginia wage records. Goes as low as 10%. |
| `Net Lifetime Difference` | $798,895 | Lifetime earnings minus high school earnings and the cost of the degree. Negatives look like `$-77,091`. |
| `ROI Ratio` | 1.31 | Below 1 means the estimated gain doesn't cover the cost. |

Values are display strings, so strip `$`, `%`, and commas before parsing.

## Method and limits

SCHEV compares projected earnings to age 67 for a program's graduates with those of the average Virginia high school graduate, after student loans and net price. It uses about 25 years of wage records ending in 2019-20, in 2023 dollars. Since March 2026 SCHEV has used ROI as one factor when reviewing public programs already flagged for possible discontinuation ([VPM News](https://www.vpm.org/news/2026-10-05/schev-roi-data-college-majors-earnings-massa-feldman-edwards/), [SCHEV documentation](https://www.schev.edu/home/showpublisheddocument/4958/639086655245370000)).

- Only graduates working in Virginia jobs covered by unemployment insurance count. Federal employees and anyone who left the state drop out.
- Graduates who earned a higher degree are excluded, which understates ROI for majors that feed graduate school.
- High Northern Virginia wages inflate ROI for programs whose graduates work there, since cost of living isn't subtracted.
- There's no occupation data, so you can't tell whether graduates work in their field.

William & Mary economist David Feldman told VPM the method is sound but shouldn't be used to rank programs across schools.
