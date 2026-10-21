# Exercise catalog review — 21 October 2026

Reviewed the 822 bundled non-cardio source names against the approved catalog,
then checked equipment, execution guides and selection behavior for the retained
and newly approved variants. The catalog now contains 111 reviewed entries plus
four weighted bodyweight variants (115 selectable entries).

## Useful variants restored

| Area | Additions and distinctions |
| --- | --- |
| Chest | Decline barbell/dumbbell press, incline dumbbell fly, hands-elevated and close-grip push-ups; machine decline press distinct from flat press |
| Shoulders | Seated versus standing strict presses, single-arm dumbbell press, Arnold press, standing/seated/chest-supported reverse fly, reverse pec deck, face pull |
| Back | Underhand barbell row, overhand lat pulldown, neutral-grip pull-ups including the weighted version; overhand/underhand/neutral grips remain distinct |
| Legs | Machine hack squat, double-dumbbell front squat, stationary split squat, forward lunge, sumo deadlift, single-leg dumbbell RDL, barbell hip thrust, single-leg glute bridge, seated versus lying leg curl |
| Arms | Concentration curl, EZ-bar preacher curl, machine curl, cable hammer curl, Bayesian curl, EZ-bar skullcrusher, overhead cable triceps extension |
| Calves/core | Bodyweight and single-leg calf raises, seated machine calf raise, machine/cable/reverse crunch, hanging knee raise |

## Catalog corrections

- Added execution keys where useful differences previously collapsed into the
  same canonical exercise: pull-up/pulldown grips, decline machine press,
  triceps cross-body/overhead extensions and kickbacks, leg curl positions and
  calf positions. No two selectable entries now share a canonical variant key.
- Seated presses now require a bench. The standing dumbbell press has a separate
  stable ID, guide and snapshot field; it does not reuse the seated illustration.
- Added dip bars and preacher bench as explicit equipment. Close-grip barbell
  bench press requires rack supports. Seated dumbbell calf raise requires a bench.
- Corrected the machine calf raise previously classified as bodyweight; added
  actual bodyweight alternatives. Single-dumbbell exercises specify one recorded
  dumbbell, and bilateral cable fly variants specify the load on each stack.
- Replaced ambiguous or contradictory instructions with bundled execution guides.
  New guides work offline without requiring an image.
- Retired duplicate lying-leg-curl ID 365 from new choices while retaining a
  historical lookup for older records, including those without snapshots.
- Extended movement-recency urgency beyond two weeks so adding variants does not
  starve a less highly ranked primary movement in short weekly sessions.

## Boundaries and verification

Near-identical source duplicates, personal routines, stretches, timed holds and
entries requiring equipment or muscles the engine does not represent were not
enabled merely because their names appeared in the source. Push press remains
excluded following the preceding change.

Regression coverage checks distinct canonical identities, actual prescription
with compatible equipment, replacement visibility, guide selection, legacy IDs,
and longitudinal movement coverage at 30/45/60 minutes across all training styles.
