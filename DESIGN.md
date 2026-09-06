# Design

Saakshi's world is a called game printed on cream stock. Every required disclosure is a named,
numbered card on one tabla that the room fills in whatever order the conversation deals it. The
direction was chosen by the owner on 2026-09-06 from a direction roll (seed `9be69d51`), over the
assigned direction, and built at full commitment. Product truth lives in `PRODUCT.md`.

## Why this world

A compliance record is not a dashboard. It is a set of things that either were or were not said,
each of which either has evidence or does not. That is the shape of a called card game: the caller
says a thing, you find it on your card, you mark it, and at the end either your row is complete or
it is not. Everyone in an Indian branch already knows how that works, which is the point.

What this refuses: the dark gradient hero with a tilted glass screenshot and an indigo accent, the
arrangement every AI compliance product ships.

## Palette

Colour is committed at page scale in flat fields behind heavy contour ink, never as accents
scattered on a neutral ground. It is light because the use scene is a bank branch desk in daylight,
two people looking at one laptop, and because the certificate has to print.

| Token | Value | What it means |
|---|---|---|
| `--paper` | `#f6eedc` | The stock everything is printed on |
| `--paper-deep` | `#ece0c6` | The tabla's own board, and quiet ribbons |
| `--ink` | `#14110e` | Contour, rules, borders, body text |
| `--ink-soft` | `#5d5346` | Secondary text, tinted from the ink and never grey |
| `--turquoise` | `#1b9aaa` | A card field, and the advisor's edge in the transcript |
| `--sun` | `#f4c430` | A card field, ribbons, the nudge |
| `--rose` | `#e4677e` | A card field, and the customer's edge in the transcript |
| `--carnival` | `#cf2118` | **Reserved.** A prohibited claim was made, and nothing else |
| `--bean` | `#7a5230` | The mark of progress |

**The red law.** Carnival red appears only where a flag has been called: the intervention banner,
the violation row, the flag mark, the crossed square on the verify page, and the primary action
that opens the room. It never decorates. A reader who sees red on this product can assume something
went wrong without reading a word.

## Type

Three faces, each with one job.

- **Alfa Slab One** (`--font-display`) shouts. Headlines, card name plates, ribbons, the verdict.
  Card plates set at 0.6875rem with 0.11em tracking in caps; headlines clamp to 5.5rem.
- **Archivo** (`--font-body`) speaks. Every sentence a person reads.
- **Spline Sans Mono** (`--font-data`) counts. Times, hashes, latencies, card numbers, statuses.
  Always `tabular-nums`, so a column of times lines up.

`.shout` carries a 4px printed shadow. It is for page-scale display only; at card-title size the
shadow smudges, so those use `font-display` directly.

## Components

- `.card-print` / `.card-print-tight`: 2px ink border and a hard offset ink shadow. This is the
  world's own material, the shadow a letterpress card throws on a table, not a neobrutalist habit.
- `.ribbon`: a section header on a sun-yellow plate with a star ornament. `.ribbon-quiet` for
  secondary sections.
- `.rule-dashed`: the dashed carnival hairline that separates regions on a printed sheet.
- `.plate`: a card's name in spaced caps. `.num`: anything countable.
- Cards are `aspect-3/4`, two across on a phone and four from `sm` up.

## Marks

`components/marks.tsx` holds every mark, drawn as SVG on a 24-unit grid at a 2-unit contour so they
sit at the same weight as the cards. No Unicode glyph or emoji is ever used as an icon.

| Mark | Means |
|---|---|
| `Bean` | The disclosure was actually made, or the customer understood |
| `BeanHalf` | She got part of it |
| `CrossMark` | Called and not marked, or a proof that does not match |
| `EmptySquare` | Not said yet |
| `FlagMark` | A prohibited claim |
| `StarOrnament` | A printed separator |
| `CallerHorn` | Saakshi speaking |
| `SealMark` | A certificate that verifies |

**Every mark ships beside its word.** Colour is never the only signal, and neither is shape: a
verdict chip carries the drawn object, the word, and a colour field, so any one of the three can be
lost without losing the meaning.

## Motion

One grammar, two moments, both weighted: they land, they do not glide.

- `.anim-bean`: a bean dropped on a card. The settle lives in the keyframes, where a real bean has
  it; the easing is a clean exponential decelerate.
- `.anim-called`: a card turned face up, rotating about its top edge.
- `.anim-shout`: the full-house line arriving.

`prefers-reduced-motion: reduce` removes all three and leaves the end state.

## Browser surfaces

Text selection is sun on ink. Focus rings are a 3px turquoise-deep outline at 2px offset.
Scrollbars are ink on paper-deep with no radius. Checkboxes and radios take `accent-color:
var(--carnival)`. Inputs and selects carry a 2px radius, matching the cards.

## Laws this world inherited

Four disciplines were donated by directions that lost the roll, and each is enforced in code:

1. **Red only past the line** (from the VU bridge). See the red law above.
2. **Nothing is cropped** (from the tabla itself). Cards carry an authored `short_label` from the
   protocol pack rather than a truncation, and no label is ever cut with an ellipsis.
3. **Every verdict is joined to its evidence** (from the tensegrity column). A marked card is
   followed by the quote and the clock time that earned it, with no hover required.
4. **The record shows its flaws** (from raku). Socket gaps, pending speakers and unanswered
   questions are first-class rows, never tidied away.

## Surfaces

- **Landing** (Persuade): the game explained by playing it. The called card and the tabla are the
  real protocol pack and a real line of the demo script, not a mockup.
- **Session room** (Operate): expression never obscures the task. The tabla is the board, the
  transcript is a ruled register, and the intervention is the only red thing on screen.
- **Verify** (Read): the certificate as a printed sheet. Legibility first, ornament at the edges,
  and it prints without the shadows.
