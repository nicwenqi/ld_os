# Recovery C real-workbook inspection

Inspection date: 2026-07-16

## Privacy boundary

- The approved workbook remains outside Git and outside Vercel Preview.
- The workbook was read locally through the trusted server parser.
- This evidence contains aggregate counts and recognized/excluded field names only.
- No employee names, employee numbers, source row values, or full checksum are recorded here.
- Zero employee rows were written during inspection.

## File evidence

- File identity: approved legacy `.xls` workbook; the real sanitized filename is intentionally omitted from committed evidence.
- File size: 133,120 bytes
- SHA-256 prefix: `245bb3a4fe12`
- Visible sheets: 3
- Selected employee sheet: `Sheet1`
- Header row: 3
- Excluded tracking sheets: `CTC 追踪表`, `GTC 追踪表`

## Aggregate employee-master evidence

- Employee candidates: 196
- Structurally valid before attribution: 194
- Blocked rows: 2
- Rows missing employee number: 0
- Rows missing department after normalization: 2
- Rows missing position: 0
- Duplicate employee numbers: 0
- Leading-zero employee numbers preserved: yes
- Valid hire dates: 196
- Invalid or ambiguous hire dates: 0
- Valid probation/confirmation dates: 196
- Invalid or ambiguous probation/confirmation dates: 0
- Distinct department source labels: 30
- Distinct position source labels: 113
- Excluded columns: 13
- Formula-derived excluded columns: 2
- Training-history or sensitive excluded columns: 11
- Employees written: 0
- Training-history rows written: 0
- CTC/GTC records written: 0

## Recognized employee-master fields

| Source field | Approved target |
| --- | --- |
| `Empid` | employee number |
| `CName` | Chinese name |
| `EName` | English name |
| `Department` | department source label |
| `Position` | position source label |
| `Grade` | grade/band |
| `JoinDate` | hire date |
| `Probation` | probation/confirmation date |

## Excluded fields

- `Gender`
- `Mini Orientation`
- `Brand Training`
- `Management Orientation`
- `Hotel Orientation`
- `Orientation Test`
- `Initial Training`
- `Onboarding Checklist`
- `Leadership Journey`
- `Problem handling`
- `First Aid`
- Formula-derived `CTC`
- Formula-derived `GTC`

Excluded values were not copied into raw or normalized staging rows and did not enter employee, KPI, course, training, attendance, feedback, or completion records.
