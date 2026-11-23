# News in One Image — 23 November 2026

A make.fun entry for **news-image-20261123**: sum up 23 November 2026's world
news in one image.

## What it does

`main.ts` (Node 22, standard library only — no dependencies, no network)
procedurally draws a 1024×1024 newspaper front page, **"THE WORLD TODAY"**,
with its own rasterizer, 5×7 bitmap font, PNG encoder, and seeded PRNG:

- **Lead:** Iran navy tankers set ablaze in the Strait of Hormuz
- **Panels:** COP31 collapse, Russian cargo ship ablaze off Finland,
  Kyiv drone strike, Sudan strikes, Ebola in DR Congo
- **In brief:** Indonesia factory fire, Nepal–India talks, South Korea
  minister resigns, India 720/9d, Kim on security, lethal-AI talks,
  Kospi −3%, El Chapo Isidro captured

## Run

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
```

Writes `out/entry.png` (1024×1024, deterministic — two runs produce
byte-identical output).

## License

MIT — see `LICENSE`.
