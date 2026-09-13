# Licensed faces

Subset woff2 builds of the two faces the Avendus design system declares:

| File | Face | Weight |
|---|---|---|
| `univia-ultralight.woff2` | Univia Pro Ultra Light | 200 |
| `univia-light.woff2` | Univia Pro Light | 300 |
| `univia-book.woff2` | Univia Pro Book | 400 |
| `univia-medium.woff2` | Univia Pro Medium | 500 |
| `franklin-book.woff2` | ITC Franklin Gothic Std Book | 400 |
| `franklin-medium.woff2` | ITC Franklin Gothic Std Medium | 500 |
| `franklin-demi.woff2` | ITC Franklin Gothic Std Demi | 600 |

Subset to the characters this dashboard actually prints: Latin, punctuation,
the arrows and marks the tables use, and the Greek alpha. 92 KB for the set.

Built with `pyftsubset` from the supplied desktop OTFs:

```
pyftsubset <face>.otf --output-file=<name>.woff2 --flavor=woff2 \
  --unicodes=U+0020-007E,U+00A0,U+00A9,U+00AB,U+00BB,U+2018-201D,U+2013,U+2014,\
U+2022,U+2026,U+2039,U+203A,U+20B9,U+2190-2193,U+2212,U+25B2,U+25BC,U+2713,\
U+00D7,U+00B7,U+03B1,U+21A8,U+2195 \
  --layout-features=kern,liga,tnum,onum,lnum --desubroutinize --no-hinting
```

**Licensing.** Univia Pro (Fontfabric) and ITC Franklin Gothic Std (Monotype)
are commercial faces, and the files supplied were desktop licences. Serving a
webfont is a separate grant under both foundries' terms, and this repository is
public, so anyone who can read it can download these files. Confirm the webfont
entitlement before this branch goes anywhere public. If it is not held, the
`@font-face` rules already name the design system's own fallbacks — Jost and
Libre Franklin — and deleting this directory drops the site onto them with
nothing else to change.
