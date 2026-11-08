# MECHANICS — Visual Paradigm CE 17.3, class-diagram evidence sheet

Every value below has a source and an address. Three kinds appear:

- **code** — read out of the shipped Java in Deep mode (`java_method_show`,
  `java_class_show`, Vineflower). The address is `jar!class#method + bytecode
  offset`, because a `.class` has no load address.
- **record** — read out of a diagram the program itself wrote (a `*.vpp` is
  SQLite; every shape stores a readable property DSL in
  `DIAGRAM_ELEMENT.DEFINITION`).
- **screen** — measured on a reference screenshot. The seven values that once
  used it were re-measured against `app/reference/vp163/1001.png`
  (`docs/MEASUREMENTS-AUDIT.md`): one confirmed (status bar 28 px), six
  rejected. No value is sourced from an unnamed screenshot any more: the sheet
  either names the file and the rows of pixels, or says `rejected` with what
  the frame shows.

## 0. The target, and how it was opened

| Step | Tool | Result |
|---|---|---|
| open the main program | `core_target_open` on `~/Visual_Paradigm_CE_17.3/bin/Visual_Paradigm` | `kind: "unknown"`, 17 166 B, sha256 `8bad3bce780a06a8…` — a POSIX **shell** launcher (install4j) |
| ask what it is | `core_target_triage` on the same path | `plain_english: "Visual_Paradigm isn't a format we recognise yet."`, `kind: "unknown"`, 17 166 B — `file(1)` agrees: *POSIX shell script, ASCII text executable* |
| open the install folder | `core_target_open` on `~/Visual_Paradigm_CE_17.3` | `kind: "directory"` |
| open the code | `core_target_open` on `lib/lib01.jar` | `kind: "jar"`, 86 003 994 B, sha256 `65f035fc7f578811…` |
| search strings / decompile a function | `native_strings_find`, `native_functions_list`, `native_function_pseudocode` | refused, with the reason: on the launcher `not_supported: Couldn't read this as a program: the file is malformed (Unknown file magic)` (it is a shell script); on `lib/vpplatform.jar` and on a single extracted `v/cco/b.class` `not_supported: A Java program is not native machine code` / `Java program code (one class) is not native machine code` |
| find names, settings and messages | `java_classes_find` (class and method names), `java_class_users_find` (references), `java_method_show` (bytecode + pseudo-Java), `java_archive_show` | used for every fact below; §13 is the result of following names → painters → polygon formulas |
| read the code | `java_classes_find`, `java_class_show`, `java_method_show`, `java_vineflower_decompile` | used throughout |
| second deep pass: the defaults | `core_target_open` (again), `native_strings_find` (again, refused), `java_method_show` on `v/dap/r#<init>` (all 1629 instructions, paged 400 at a time), `v/dap/r#<clinit>`, `v/dan/i#b` (628), `java_class_show --decompile` on `v/dap/r` (the setters), `java_method_show` on `v/ccq/{h,n,c,q}#<init>` | §1b, §1c and §2 rewritten from it: 30 settings with setter, field, default and both offsets |
| third deep pass: the fill | `core_target_open` (launcher and `lib/vpplatform.jar`), `native_strings_find "gradientStyle"` and `native_function_pseudocode 0x1000` — **both refused** (`not_supported: A Java program is not native machine code`); then `java_classes_find`/`java_method_show` down `@gradientStyle` → `v/cmw/aw` → `v/cmw/i` | §14: the fill rule, the 16 gradients and why `@type=1` paints flat |
| fourth deep pass: the note | `core_target_open` on `lib/vpplatform.jar` (`kind: "jar"`, sha256 `21cb38990702…`); `native_strings_find` / `native_function_pseudocode` **refused again**, same reason; then `java_method_show v.mm#initDiagramElementClassTable` (3 337 instructions), `v.cnk.hw#<init>`, `v.cnk.hw#b`, `v.bet.kw#getAngle`, `v.cmn.al#a(…)`, and `java_class_show` on `INoteUIModel` and `v.cnk.ach` | §15: the 834-type shape registry, the note's model chain and the 12 / 15 px the record really stores |
| fifth pass: the native tools on the main program | `core_target_open` on `bin/Visual_Paradigm`, then `native_strings_find`, `native_functions_list`, `native_function_pseudocode` — **all refused, verbatim in §16a**; a control run of the same three on `jre/bin/java` returned 24 functions and 7 lines of pseudo-C | §16: proof the native toolset works and the target is not machine code, then the enum behind the visibility mark |
| ninth pass: the main program again | `core_target_open` → `kind: "unknown"` (sha256 `8bad3bce780a…`); `native_strings_find` / `native_function_pseudocode` → `not_supported` again, control on `jre/bin/java` → 0 matches; then a constant-pool string scan of both jars and `java_method_show` on every class it named | §20: the empty-compartment codes (0 Follow / 1 Yes / 2 No), the class/default/diagram tables behind them, and the sequence spacing defaults 80/30 in code |
| sixteenth pass: line jumps | `core_target_open` on `bin/Visual_Paradigm` → `kind: "unknown"`, sha256 `8bad3bce780a…`; `native_strings_find "LineJump"` and `native_function_pseudocode 0x1000` → `not_supported` (*Unknown file magic*); control on `jre/bin/java` → `kind: "elf"`, 0 matches; then `db_sqlite_show` on the person's `.vpp` and `java_method_show` on `v/dap/r#bR(B)` / `#e(B)` / `#<init>` and `v/cct/dy` | §26: the five jump codes, the three defaults, the two records that disagree, and the geometry taken from the program's own toolbar art |
| seventeenth pass: the curve and the rounded corner | `core_target_open` on `bin/Visual_Paradigm` → `kind: "unknown"`, 17 166 B, sha256 `8bad3bce780a…`; `native_strings_find "Curve"` and `native_function_pseudocode 0x1000` → `not_supported: Couldn't read this as a program: the file is malformed (Unknown file magic)`; then `java_class_users_find v/cmo/ii#ce()` → `v/dfl/acb#a(Z,I)` → `v/cct/ju#a(C)` → `v/cct/ba#l()` (277), `v/cdi/g` + `v/cdi/f`, `v/cct/es#a(D)` (236) | §27: the Curve connector is a natural cubic spline sampled 161 times, the rounded corner is a 7 px cut and one cubic — both run against the original's own classes, numbers included |
| eighteenth pass: the arrow's size code | `core_target_open` on `bin/Visual_Paradigm` → `kind: "unknown"`, 17 166 B, sha256 `8bad3bce780a…`; `native_strings_find "Diagram"` and `native_function_pseudocode 0x1000` → `not_supported: Couldn't read this as a program: the file is malformed (Unknown file magic)`; then `core_target_open` on `lib/vpplatform.jar` (`kind: "jar"`, sha256 `21cb38990702…`) → `v/cco/b#e()` (45 names → classes) → `v/cco/a#<init>`/`#b()`/`#c()` → `v/ccq/{h,c,n,q}#<init>` (the `k[]`/`l[]` tables) → `v/ccq/h#a(…)` → `v/ccq/bk#a(…,DD)` | §29: a head is drawn at `k[size]·a` by `l[size]·b` with size 2 as the factory default, so codes 0…6 make it 0.67…5.56 of its base — the build now stores the code per end |
| nineteenth pass: the caption box | `core_target_open` on `bin/Visual_Paradigm` → `kind: "unknown"`, sha256 `8bad3bce780a…`, `target_id: t_8bad3bce780a`; `native_strings_find "Diagram"` / `native_function_pseudocode 0x1000` → `not_supported` (*Unknown file magic*); `core_target_open` on `lib/vpplatform.jar` → `kind: "jar"`, sha256 `21cb38990702…`, then the same two tools → `not_supported: A Java program is not native machine code`; **control** `core_target_open` on `jre/bin/java` → `kind: "elf"`, sha256 `e94ab2b5afc1…`, `native_functions_list` → 24 functions, `native_function_pseudocode 0x950` → 60 lines of pseudo-C (`main` → `JLI_Launch`, JRE 11.0.16.1+1). Then the Java path: `java_class_show ICaptionUIModel` → `v/cmo/lr#b` (the six DSL keys) → `v/cmo/er#<init>`/`#e(I)`/`#k()` → `v/bep/i#getCaptionUIModel` → the records of `myProject.vpp` | §30: `@side` is a placement code 1…12, not a pixel inset, and a name plate is `lines × 14` with no padding — the build now draws it that way |
The craft tools are MCP tools of the app; in this session they were not
registered in the agent's tool list, so every call went through the shipped
server on the command line — `craft-anything-cli --project investigation.cany
--deep <tool> …` — which is the same `craft-anything mcp` server and writes the
same evidence records.

The program behind the launcher is **Java bytecode** (`jre/bin/java … -cp
lib/*.jar`), so the native tools cannot see it; Ghidra's analysis of the shell
script fails for the same reason. Deep mode's Java path was used instead. Each
call below left an evidence record in `investigation.cany/evidence/`.

That is not a shortcut around a native core: the install holds **no native
code of Visual Paradigm's own**. The only machine code in the folder is the
bundled JRE (`jre/bin/*`, `jre/lib/*.so`), install4j's `uninstaller/uninstall`
and the third-party payloads inside the jars (`org/sqlite/native/**/libsqlitejdbc.so`
in `lib05.jar`, `jniwrap*.dll` in `lib07.jar`, `7.30.3/libtoolkit.so` in
`lib09.jar`, one `WU.dll` in `lib02.jar`). Everything the person sees — every
default, painter, arrowhead, dash table and the fill factory in §14 — is
`v/*` classes in `lib01.jar` and `vpplatform.jar`.

### Code map

| Where | What it is |
|---|---|
| `vpplatform.jar!v/dap/r` | `VPPreference` — every diagram default is a field initialiser here |
| `vpplatform.jar!v/dan/i` | the reader that applies a stored `Diagram` preference block |
| `vpplatform.jar!v/cpo/abx` | the class shape's property schema and context menu |
| `lib01.jar!v/bet/gg` | `IClassUIModel` / `ICompartmentsOwnerUIModel` implementation (compartments, per-compartment colours) |
| `openapi.jar!com/vp/plugin/diagram/shape/IClassUIModel` | the public shape API: 91 fields, 96 methods, `getVisibilityStyle()/setVisibilityStyle(int)` among them |
| `lib01.jar!v/bet/ob` | the second `IClassUIModel` implementation (interface/robustness variants) |
| `lib/vpplatform.jar!.defaultvpuml.properties` | packaged first-run preferences (§3) |
| `vpplatform.jar!v/cco/b#e()` | the arrowhead registry: 45 names → painter classes (§13a) |
| `vpplatform.jar!v/cco/a` | the shared head base: length `a`, width `b`, size code `x`, multipliers `k[]`/`l[]` (§13b) |
| `vpplatform.jar!v/ccq/{a,bk,bb,n,h,c,q}` | the painters and the four heads this build uses (§13c–d) |
| `vpplatform.jar!v/dal/au#<clinit>()` | the 23 `BasicStroke` line styles with their dash arrays (§13e) |
| `lib01.jar!v/cmw/i` | the fill model: type, two colours, gradient style, alpha (§14a) |
| `lib01.jar!v/cmw/aw` | the paint factory: solid, or one of 16 gradients (§14a–b) |
| `lib01.jar!v/ber/e#setLineStyle` | `LineStyle` ordinal → `au.a[index]` (§13e) |
| `vpplatform.jar!v/dal/ak` | the interaction-layout options: 80 / 30 absolute spacings, 0 relative, built in `<init>` (§21b) |
| `vpplatform.jar!v/dap/o` | the Auto Layout spacing block — `BendDistance` 20, `HorizontalSpacing` 10, `VerticalSpacing` 10, `PreferredAspectRatio` 1.41 (§21c, §21e) |
| `vpplatform.jar!v/daj/ac` | the layout settings model that owns a `v/dap/o` (`<init>+0x0501`, save/restore at `bD()`) |

## 1. Diagram defaults in code — `v/dap/r`

### 1a. Static constants — `v/dap/r#<clinit>()V`

The complete table (fonts, colours, and the offsets they are built at) is §1c;
it is the same method, re-read instruction by instruction in the second pass.

### 1b. Every setting: key → setter → field → default — `v/dap/r#<init>()V`

30 keys, read once at start-up. The reader (`v/dan/i#b`) looks a key up by name,
converts it, and calls a setter on `VPPreference`; the setter is what names the
field, so this table is read in two directions instead of guessed from field
order. `+0x` is the `putfield` offset in `<init>`; the constant is the
instruction just before it (`const_off` in the raw dump).

| Field | `+0x` | Setting (reader key) | Setter | Code default |
|---|---|---|---|---|
| `DR` | `+0x0007` | `AlignToGrid` | `v/dap/r#a(Z)V` | `false` |
| `DY` | `+0x0030` | `ClassVisibilityStyle` | `v/dap/r#b(B)V` | `1` |
| `Ea` | `+0x003a` | `DefaultConnectorStyle` | `v/dap/r#d(B)V` | `1` |
| `Ee` | `+0x0054` | `DefaultDiagramBackground` | `v/dap/r#b(Ljava/awt/Color;)V` | `Color(255,255,255)` = `#ffffff` |
| `Ef` | `+0x0059` | `DefaultDisplayAsRobustnessAnalysisIcon` | `v/dap/r#c(Z)V` | `true` |
| `Eh` | `+0x0063` | `DefaultDisplayAsStereotypeIcon` | `v/dap/r#e(Z)V` | `false` |
| `Ei` | `+0x006a` | `DefaultFont` | `v/dap/r#b(Ljava/awt/Font;)V` | `Font("Dialog",0,11)` |
| `Ej` | `+0x0071` | `DefaultFontColor` | `v/dap/r#c(Ljava/awt/Color;)V` | `Color(0,0,0)` = `#000000` |
| `Es` | `+0x00b0` | `DefaultShowAttribute` | `v/dap/r#f(B)V` | `1` |
| `Et` | `+0x00b5` | `DefaultShowAttInitValue` | `v/dap/r#g(Z)V` | `true` |
| `Eu` | `+0x00ba` | `DefaultShowAttMultiplicity` | `v/dap/r#h(Z)V` | `false` |
| `Ev` | `+0x00bf` | `DefaultShowClassMemberStereotype` | `v/dap/r#i(Z)V` | `true` |
| `Ey` | `+0x00ce` | `DefaultShowOperation` | `v/dap/r#g(B)V` | `1` |
| `EB` | `+0x00dd` | `DefaultShowOperSignature` | `v/dap/r#l(Z)V` | `true` |
| `ED` | `+0x00e7` | `DefaultShowOwner` | `v/dap/r#m(Z)V` | `false` |
| `EF` | `+0x00f1` | `DefaultShowTemplateParameter` | `v/dap/r#o(Z)V` | `true` |
| `EG` | `+0x00f6` | `GraphicsAntialiasing` | `v/dap/r#p(Z)V` | `true` |
| `EH` | `+0x00fb` | `TextAntialiasing` | `v/dap/r#q(Z)V` | `true` |
| `EJ` | `+0x0105` | `ShowGrid` | `v/dap/r#s(Z)V` | `false` |
| `EK` | `+0x010c` | `GridColor` | `v/dap/r#d(Ljava/awt/Color;)V` | `Color.LIGHT_GRAY` = `#c0c0c0` |
| `EL` | `+0x0112` | `VerticalGridSize` | `v/dap/r#g(I)V` | `10` |
| `EM` | `+0x0118` | `HorizontalGridSize` | `v/dap/r#h(I)V` | `10` |
| `EO` | `+0x0122` | `ShowExtraResourceCentric` | `v/dap/r#u(Z)V` | `false` |
| `EQ` | `+0x012c` | `ShowModelAssist` | `v/dap/r#w(Z)V` | `true` |
| `ER` | `+0x0131` | `ShowNumInCollaborationDiagram` | `v/dap/r#x(Z)V` | `true` |
| `ES` | `+0x0136` | `ShowNumInSequenceDiagram` | `v/dap/r#y(Z)V` | `true` |
| `EU` | `+0x0142` | `ShowShapeContentWhenDragging` | `v/dap/r#z(Z)V` | `true` |
| `EV` | `+0x0147` | `TAHighlightOption` | `v/dap/r#k(B)V` | `0` |
| `EY` | `+0x015c` | `DefaultShapeBackground` | `v/dap/r#f(Ljava/awt/Color;)V` | `Color(122,207,245)` = `#7acff5` |
| `EZ` | `+0x0163` | `DefaultShpaeForeground` | `v/dap/r#g(Ljava/awt/Color;)V` | `Color.BLACK` = `#000000` |

**Corrections to earlier drafts of this sheet.** `ShowGrid` is written by
`r.s(Z)` (field `EJ`), not `r.p(Z)`: `p(Z)` is `GraphicsAntialiasing` (`EG`).
`DefaultShapeBackground` is `r.f(Color)` → `EY`; the foreground is
`r.g(Color)` → `EZ`.

### 1c. Static constants — `v/dap/r#<clinit>()V`, in full

| Offset | Constant | Value |
|---|---|---|
| `+0x0000` | `P` | `new Font("Dialog", 0, 11)` — connector font |
| `+0x0010` | `R` | `new Color(0, 0, 0)` — connector font colour |
| `+0x001d` | `T` | `new Color(255, 255, 255)` — diagram background |
| `+0x0030` | `ab` | `new Font("Dialog", 0, 11)` — default font |
| `+0x0040` | `ad` | `new Color(0, 0, 0)` — default font colour |
| `+0x004d` | `af` | `null` (no override font) |
| `+0x0051` | `bp` | `Color.LIGHT_GRAY` = `#c0c0c0` — grid colour |
| `+0x0057` | `bP` | `new Font("Dialog", 0, 22)` |
| `+0x0067` | `bR` | `new Color(0, 0, 0)` |
| `+0x0074` | `bT` | `new Color(122, 207, 245)` = `#7acff5` — shape fill |
| `+0x0086` | `bV` | `Color.BLACK` = `#000000` — shape ink |

## 2. Reader — `v/dan/i#b(Lv/dvk/i;Lv/daj/ac;)Z`

628 instructions. Every key is looked up by name, converted, then written
through the setter in §1b. Offsets are where the key string is loaded.

| Offset | Key | Setter → field | Code default |
|---|---|---|---|
| `+0x004f` | `AlignToGrid` | `v/dap/r#a` → `DR` | `false` |
| `+0x0073` | `DefaultDiagramBackground` | `v/dap/r#b` → `Ee` | `Color(255,255,255)` = `#ffffff` |
| `+0x0097` | `DefaultShapeBackground` | `v/dap/r#f` → `EY` | `Color(122,207,245)` = `#7acff5` |
| `+0x00bb` | `DefaultShpaeForeground` | `v/dap/r#g` → `EZ` | `Color.BLACK` = `#000000` |
| `+0x00df` | `GridColor` | `v/dap/r#d` → `EK` | `Color.LIGHT_GRAY` = `#c0c0c0` |
| `+0x0103` | `GraphicsAntialiasing` | `v/dap/r#p` → `EG` | `true` |
| `+0x0127` | `HorizontalGridSize` | `v/dap/r#h` → `EM` | `10` |
| `+0x014b` | `ShowExtraResourceCentric` | `v/dap/r#u` → `EO` | `false` |
| `+0x016f` | `ShowGrid` | `v/dap/r#s` → `EJ` | `false` |
| `+0x0193` | `TextAntialiasing` | `v/dap/r#q` → `EH` | `true` |
| `+0x01b7` | `VerticalGridSize` | `v/dap/r#g` → `EL` | `10` |
| `+0x01db` | `ClassVisibilityStyle` | `v/dap/r#b` → `DY` | `1` |
| `+0x01ff` | `DefaultShowAttribute` | `v/dap/r#f` → `Es` | `1` |
| `+0x0247` | `DefaultShowOperation` | `v/dap/r#g` → `Ey` | `1` |
| `+0x028f` | `ShowNumInCollaborationDiagram` | `v/dap/r#x` → `ER` | `true` |
| `+0x02b3` | `ShowNumInSequenceDiagram` | `v/dap/r#y` → `ES` | `true` |
| `+0x02d7` | `ShowShapeContentWhenDragging` | `v/dap/r#z` → `EU` | `true` |
| `+0x035a` | `DefaultConnectorStyle` | `v/dap/r#d` → `Ea` | `1` |
| `+0x037e` | `ShowModelAssist` | `v/dap/r#w` → `EQ` | `true` |
| `+0x03a2` | `DefaultFont` | `v/dap/r#b` → `Ei` | `Font("Dialog",0,11)` |
| `+0x03c6` | `DefaultFontColor` | `v/dap/r#c` → `Ej` | `Color(0,0,0)` = `#000000` |
| `+0x03ea` | `TAHighlightOption` | `v/dap/r#k` → `EV` | `0` |
| `+0x040e` | `DefaultShowAttInitValue` | `v/dap/r#g` → `Et` | `true` |
| `+0x0432` | `DefaultShowAttMultiplicity` | `v/dap/r#h` → `Eu` | `false` |
| `+0x0456` | `DefaultShowOperSignature` | `v/dap/r#l` → `EB` | `true` |
| `+0x047a` | `DefaultShowClassMemberStereotype` | `v/dap/r#i` → `Ev` | `true` |
| `+0x049e` | `DefaultShowOwner` | `v/dap/r#m` → `ED` | `false` |
| `+0x04c2` | `DefaultShowTemplateParameter` | `v/dap/r#o` → `EF` | `true` |
| `+0x04e6` | `DefaultDisplayAsRobustnessAnalysisIcon` | `v/dap/r#c` → `Ef` | `true` |
| `+0x050a` | `DefaultDisplayAsStereotypeIcon` | `v/dap/r#e` → `Eh` | `false` |

Two keys are **not** copied as-is, and the mapping is in the reader:

| Key | Rule |
|---|---|
| `DefaultShowAttribute` | `10 → 0`, `11 → 1`, `12 → 2` (`+0x021e`–`+0x0243`), then `r.f(B)`; any other value leaves the field alone |
| `DefaultShowOperation` | same three-way mapping (`+0x026a`–`+0x028b`), then `r.g(B)` |
| `DefaultConnectionPointStyle` | `2 → 1`, everything else `0` (`+0x0318`–`+0x0327`), then `r.c(B)` |

**Consequence for us:** the three-way choice for attributes/operations is a
*preference*, not a per-shape flag; a shape may still override it (see §4).

## 3. Packaged first-run preferences — `.defaultvpuml.properties`

Inside `vpplatform.jar`, `<title name="Diagram">`:

    AlignToGrid=true            DefaultDiagramBackground=255, 255, 255
    DefaultShapeBackground=200, 200, 240
    DefaultShpaeForeground=0, 0, 0
    GridColor=0, 0, 0           HorizontalGridSize=10   VerticalGridSize=10
    ShowGrid=false              GraphicsAntialiasing=true   TextAntialiasing=true

**Rule:** this file is applied over the code defaults on a fresh install —
that is why a new diagram snaps to a 10 px grid although `DR` is `false` in
code. The layers disagree on two values and both are real: code grid colour
`#c0c0c0` vs packaged black; code shape fill `rgb(122,207,245)` vs packaged
`rgb(200,200,240)`.

## 4. Class shape property schema — `v/cpo/abx#a(I)V`

    this.a(new nw(this.eF, 6, "Visibility Style", 1), new aez(this, var1),
           "visibilityStyle", int.class);

The property is declared with **type 6** and **default 1**, exposed as the
"Visibility Style" menu — three choices, matching the three values the reader
copies through (§2). The three are `VS_ICON = 0`, `VS_UML = 1`, `VS_OFF = 2`,
labelled "Icon" / "UML" / "Off" (§16), so the default 1 is the **UML
characters**, not an icon. Same class registers "Show Initial Value"
(`ShowAttributeInitialValue`) and "Show Signature" (`ShowOperationSignature`).

The public API (`openapi.jar!com/vp/plugin/diagram/shape/IClassUIModel`, Java 6,
91 fields / 96 methods) exposes the same thing as
`int getVisibilityStyle()` / `void setVisibilityStyle(int)`.

## 5. Records the program writes — the real shape and connector DSL

### 5a. ClassDiagram, shipped sample `resources/BaggageSchemas.vpp`

| Key | Value | Effect |
|---|---|---|
| `gridWidth` / `gridHeight` | `10` / `10` | 10 px grid |
| `gridColor` | `(192,192,192,255)` | `#c0c0c0` |
| `gridVisible` | `F` | grid off until asked for |
| `alignToGrid` | `F` | snapping off in the record (packaged preference turns it on) |
| `diagramBackground` | `(255,255,255,255)` | white sheet |
| `connectorStyle` | `1` | **Oblique** — `connectorStyle.1` is the program's own name for this number (`lib01.jar!v/cni/b#a+0x0487`, §24c); the file's connectors each store their own `_points`, so the drawn route is that polyline whatever the diagram value says |
| `connectionPointStyle` | `0` | free connection points |
| `paintConnectorThroughLabel` | `1` | **the line runs through the label** — no halo |
| `connectorLabelOrientation` | `0` | horizontal label |
| `showStereotypes` | `T` | stereotype line above the name |
| `showClassEmptyCompartments` | `2` | empty compartments collapse |
| `showAssociationNavigationArrows` | `3` | no navigation arrowheads |
| `generalizationSetNotation` | `2` | plain shared-target triangle |
| `showEllipsisForUnshownClassMembers` | `2` | ellipsis for clipped members |
| `autoFitShapesSize` | `F` | shapes keep their size |
| `modelElementNameAlignment` | `4` | name centred |
| `pointConnectorEndToCompartmentMember` | `T` | ends point at the member row |
| `connectorLineJumps` / `…Size` | `0` / `0` | no line jumps |
| `suppressImplied1MultiplicityForAttributeAndAssociationEnd` | `F` | implied `1` is drawn |

### 5b. Class shape, same sample (row `tEUB0LqGAqAKag2a`, «Entity»)

| Key | Value | Note |
|---|---|---|
| `width` / `height` | `80` / `40` | this one is a robustness-analysis icon class |
| `_captionUIModel` | `@height=15; @side=4` | name caption is **15 px** in 17.3 |
| `_lineModel` | `@cap=0; @weight=1.0; @color=(0,0,0,255); @hasStroke=T; @transparency=0` | 1 px black, **butt cap** |
| `_fillColor` | `@gradientStyle=1; @type=1; @transparency=0; @color1=(122,207,245,255)` | gradient record, painted flat |
| `_elementFont` | `Dialog 11`, style 0 | |
| `visibilityStyle` | `1` | members shown as icons |
| `showAttributeType` / `showOperationType` | `1` / `1` | types printed |
| `showOperationSignature` | `T` | full signature |
| `showInitialAttributeValue` | `T` | `= value` |
| `showParameterNameInOperationSignature` | `T` | |
| `parentConnectorHeaderLength` / `…LineLength` | `40` / `10` | note dog-ear: 10 px along the border, then 40 px straight |
| `interfaceBall` | `F` | |

### 5c. Class shape, the person's own 16.3 template (`myProject.vpp`)

| Key | Value |
|---|---|
| `width` / `height` | `190` / `170` |
| `_captionUIModel` | `@height=14; @side=12` — **14 px** here |
| `_elementFont` | `Arial 11`, style 0 |
| `_lineModel` | `@cap=0; @weight=1.0` |
| `visibilityStyle` | `1` |

So the caption height is **stored per shape**, not a constant: 14 px in the
person's template, 15 px in the 17.3 sample. Our build uses 14 (the template
the person actually works in) and takes it from the sheet.

### 5d. Connectors

| Record | Values |
|---|---|
| `Generalization` | `_lineModel @cap=0 @weight=1.0`; `_captionUIModel @height=0 @side=1`; `_points` are relative bends; `fromPinType=1; toPinType=1` |
| `Association` | `showFromMultiplicity=T; showToMultiplicity=T; showMultiplicityConstraints=F` (17.3) / `T` (16.3); `useFromShapeCenter=T; useToShapeCenter=T`; `multiplicityARectangle=(-1,-20,39,15)`; `multiplicityBRectangle=(-29,0,27,15)`; `hasMultiplicityAShape=T; hasMultiplicityBShape=T` |
| `Dependency` / `Realization` | same `_lineModel`; some records add `connectorLineJumps` |

Multiplicity boxes are therefore **39×15** and **27×15**, placed **20 px** off
the line (`y = -20` for the A end, `x = -29` for the B end).

### 5e. What the records do **not** contain

Checked by reading every key of every `Class`, `Association`, `Generalization`,
`Dependency` and `Realization` row, and by counting child rows
(`PARENT_ID` non-null: only `NOTE`/`Part` in the template, `PERTTask`/`UseCase`
in the sample):

- no arrowhead geometry — no arrow key, no arrow child shape;
- no dash pattern — a dashed Dependency is the same `_lineModel` as a solid one;
- no visibility glyph artwork — `visibilityStyle=1` only says "draw icons".

These three are drawn by code that builds its primitives at runtime; they stay
placeholders (§8).

## 6. Stereotype profile

The profile the application loads at boot is `app/profile/stereotypes.json` —
**304 stereotypes** (`src/io/stereotypes.js#PROFILE_PATH`). It is built by
`tools/build-profile.mjs` from `material/profile-canonical/`, not parsed from XML
at start-up (разбор XML на старте — то, что было раньше; канон считает дубли
один раз при сборке).

The build input is `material/stereotypes.xml`: root `<Stereotypes version="20090707">`,
`ApplicationStereotypes` (405) + `ProjectStereotypes` (23) = **428**
`<Stereotype>` elements → **407** definitions after merging duplicates → **304**
stereotypes after canonicalising names (`docs/uml/profile.md`).
Each record carries `name`, `baseType`, `documentation`,
`id`, `abstract/leaf/root`; some nest `TaggedValueDefinitionContainer` with
typed `TaggedValueDefinition`s (0 = text, 2 = enumeration with
`EnumerationValues`, 3 = long text) plus `defaultValue`.

| Element | `baseType` accepted |
|---|---|
| class | Class |
| interface | Interface, Class |
| enumeration | Class |
| package | Package |
| note | NOTE |
| association | Association |
| dependency | Dependency, Abstraction, Usage |
| generalization | Generalization |
| realization | Realization |

Counts: Class 67, Interface 5, Package 14, NOTE 6, Association 6,
Dependency 12 + Abstraction 3 + Usage 7, Generalization 4, Realization 3.

## 7. Where the build uses each value

`mechanics.json` is the single source. `build.mjs` turns the rows named in
`SHEET_KEYS` into `src/mechanics.generated.js`; nothing else in `src/` holds a
number that the sheet also knows.

| Sheet value | Value | Code address | Used by |
|---|---|---|---|
| `name caption height` | 14 | `myProject.vpp` Class `_captionUIModel@height` | `src/model/geometry.js#TAB_H` (package tab) |
| `caption line height` | 14 | `myProject.vpp`: 32 Class records without a stereotype store `@height=14`, 15 with one store 28, 2 with one store 42; code: `v/cmo/er#<init>()V` leaves the height at 0 and `v/bep/i#resetCaptionSize()V+0x0004` only flags a recompute (§30) | `geometry.js#CAPTION_LINE` → `layoutOf` (`nameH = lines × 14`, no padding) and every renderer's name line: `renderClassifier`, `renderComponent`, `renderState`, `renderBoundary`, `renderActivity` |
| `note caption side` | 12 = `SIDE_FREEMOVE` | `ICaptionUIModel` `SIDE_NONE=1 … SIDE_FREEMOVE=12` (`openapi.jar`), stored by `v/cmo/lr#b+0x0083` → `v/cmo/er#e(I)+0x000b` (§30) | `geometry.js#CAPTION_SIDE_FREEMOVE` — the caption is placed freely inside the shape, which is why its box starts at `0,0` |
| `note text inset` | 12 | **the build's own** — the record carries no text inset (§30, §8) | `geometry.js#NOTE_PAD` (note text x), `#NOTE_FOLD` (the cut corner), `render.js#renderNote` |
| `note caption width delta` | 15 | `myProject.vpp` NOTE `_captionUIModel@width` = shape width − 15 (80→65, 140→125, 90→75) | `geometry.js#NOTE_CAP_DELTA` — note text wraps to `w − 15 − 12`, the cut is `min(12, w − 15)` |
| `stroke line cap` | `butt` | Class `_lineModel@cap=0` | `src/styles.css` `.conn`, `.sh-body`, `.sh-tab` |
| `visibility style` | 1 (UML characters) | `v/dap/r#<init>+0x0030`, `v/cpo/abx#a(I)`, `IClassUIModel.VS_UML` (§16) | `src/ui/render.js#renderVisibilityIcon` |
| `connector style` | rectilinear (1) | `v/dap/r#<init>+0x003a` | `src/model/geometry.js#routePoints` |
| `grid size` | 10 | `v/dap/r#<init>+0x0112/+0x0118` | `src/ui/canvas.js#SNAP` (kept as the square-grid alias) |
| `grid width` / `grid height` | 10 / 10 | `v/dap/r#<init>+0x0118` (`EM`) / `+0x0112` (`EL`), setters `h(I)` / `g(I)` report them as `GridWidth` / `GridHeight` | `canvas.js#SNAP_X`, `#SNAP_Y` — the SVG pattern and both drop points use them separately |
| `align to grid (effective)` | `true` | code `+0x0007` false, packaged `.defaultvpuml.properties` true | `canvas.js#snapTo()` — snapping is a switch now, not a constant |
| `grid visible by default` | `false` | `v/dap/r#<init>+0x0105` (`EJ`), setter `s(Z)` | `store.js` `ui.showGrid` initial value |
| `class visibility style` | 1 | `v/dap/r#<init>+0x0030` (`DY`), setter `b(B)`; `IClassUIModel.VS_ICON=0 / VS_UML=1 / VS_OFF=2` (§16) | `render.js#renderVisibilityIcon` — 0 draws icons, 1 the `+ - # ~` characters, 2 nothing |
| `default connector style` | 1 | `v/dap/r#<init>+0x003a` (`Ea`), setter `d(B)` | `geometry.js#DEFAULT_ROUTE` — 1 rectilinear, 0 direct |
| `grid colour` | `#c0c0c0` | `v/dap/r#<init>+0x010c` | grid pattern in `canvas.js` |
| `sheet background` | `#ffffff` | `v/dap/r#<init>+0x0054` | `src/styles.css` `--sheet` |
| `shape border weight` | 1 | `_lineModel@weight=1.0` | `src/styles.css` |
| `show empty compartments: follow diagram / yes / no` | 0 / 1 / 2 | `lib01.jar!v/cni/a#z+0x0c11` default `0`; labels `v/cni/b#b+0x1fd5/+0x1fe2/+0x1fef`; storage `v/cnk/er#M(I)` → field `gH`, notification `"showEmptyCompartments"` (§20) | `geometry.js#EC_FOLLOW/EC_YES/EC_NO`, `#emptyCompartmentsShown`, `#layoutOf` — an empty attribute/operation band is drawn only while it is on |
| `show empty compartments: diagram default` | 1 (Yes) | **decision** — the diagram key is a checkbox and stores only 1/2; the registry default `0` is the class's "follow" (§20) | `geometry.js#EC_DEFAULT` |
| `association multiplicity box` | 39×15 / 27×15, 20 px off the line | Association record | `src/model/geometry.js#multiPos` |
| `toolbar height` / panels / sample zoom | 78 / 236 / 300 / 75 | **rejected** — in `reference/vp163/1001.png` the bands are 28/22/84, the panel is 202 (328 in `1001a.png`), there is no right panel, no zoom text (`docs/MEASUREMENTS-AUDIT.md` §4) | not used |
| `status bar height` | 28 | measured: `reference/vp163/1001.png`, y 475…502 | `theme.js` (`REJECTED_REFERENCE`), layout is CSS |
| `stereotype profile` | 304 | `app/profile/stereotypes.json` (собирается `tools/build-profile.mjs` из `material/profile-canonical/`; 428 записей VP → 407 определений → 304 стереотипа, `docs/uml/profile.md`) | `src/io/stereotypes.js#PROFILE_PATH` |
| `hollow arrow head` | 8×11 | `vpplatform.jar!v/ccq/h#<init>+0x0085/+0x008b` (§13d) | `geometry.js#HEAD_TRI/HEAD_TRI_W` → `renderHead('triangle')` |
| `port size` | 13×13 | `vpplatform.jar!v/due/f#a(v.drc.b,v.dvk.i,v.cmo.gj,v.drc.l)+0x0202…+0x020a` — `new Dimension(13, 13)` for `v.cnk.ade` = `Port` (§33d) | `notation/uml.json#shapes.port.defaultSize`, `src/io/plantuml-layout.js#DEFAULT_SIZE.port`, `src/model/sample.js#PORT` → `render.js#renderPort`; `build.mjs` refuses a build where the two disagree |
| `solid arrow head` | 7×4 | `v/ccq/n#<init>+0x0006/+0x000b` (§13d) | `HEAD_SOLID/HEAD_SOLID_W` → `renderHead('filledTriangle')` |
| `open arrow head` | 8×4 | `v/ccq/c#<init>+0x0006/+0x000b` (§13d) | `HEAD_OPEN/HEAD_OPEN_W` → `renderHead('open')` |
| `diamond head` | 8×16 | `v/ccq/q#<init>+0x0012/+0x0018` (§13d) | `HEAD_DIAMOND/HEAD_DIAMOND_W` → `renderHead('diamond')` |
| `dashed line` | `8 5` | `v/dal/au#<clinit>` entry 2 = `LineStyle.Style2` (§13e) | `DASH` → `.conn.dash`, `.sh-dash`, `--dash` in `styles.css` |
| `fill type solid` / `gradient` | 1 / 2 | `v/cmw/i#<clinit>` a/b, `v/cmw/aw#a(cn,Rectangle)` (§14a) | `src/model/fill.js#FILL_SOLID/FILL_GRADIENT` |
| `gradient directions` | 16 | `v/cmw/aw#a(I,Rectangle,Color,Color)` 614 instr. (§14b) | `fill.js#GRADIENT_STYLES` → `render.js#ensureGradient` |
| `gradient cyclic` | `true` | `+0x04c6` `iconst_1` (§14b) | `fill.js#GRADIENT_SPREAD` → `spreadMethod="reflect"` |

## 8. Values still measured on the screen, or placeholders

| Value | Value | Why it is not in code or records |
|---|---|---|
| window layout at 1440×900 (**rejected**) | toolbar 78 px, left 236 px, right 300 px | the frame shows 28 + 22 + 84 px bands, a 202 px left panel (328 in `1001a.png`) and no right panel at all — `docs/MEASUREMENTS-AUDIT.md` §4.1–4.3; the values stay in `mechanics.json` with `rejected: true` |
| status bar height | 28 px | measured in `1001.png`, y 475…502 (`MEASUREMENTS-AUDIT.md` §4.4); the window layout itself follows `design/density-spec.md` (24) |
| zoom on the sample sheet (**rejected**) | 75 % | the status bar of the frame has no text pixels at all (§4.5); zoom is session state |
| visibility glyph artwork (**rejected colours**) | ● public `#1a7f37`, ■ private `#b3261e` — both **rejected**: neither colour exists in `1001.png`, the nearest pixels are a palette icon (8,112,66) and a window-corner detail (174,61,47) (`MEASUREMENTS-AUDIT.md` §4.6–4.7). Glyphs are drawn monochrome (`currentColor`); ▲ `#9a6700`, ◆ `#1f5fa9` are **placeholders** — and §22 now shows they are not the program's either: the two literals occur in no constant pool of the 19 jars and in no resource file of the installation | `visibilityStyle=0` (`VS_ICON`) is the state that says "icons"; the factory default and every class record here store 1 (`VS_UML`), so the sheet draws characters and the glyph colours are only reachable in state 0 (§16, §22a) |
| arrowhead geometry | **resolved in §13**: `HollowArrow1` 8×11, `SolidArrow1` 7×4, `Arrow1` 8×4, `HollowDiamond` 8×16, with a 7-step size multiplier table | read from the painters `v/ccq/*` — the records carry no arrow key (§5e), the code does |
| dash pattern of Dependency / Realization | **resolved in §13**: `LineStyle.Style2` = `8 5` (`v/dal/au#<clinit>` entry 2) | the record stores the same `_lineModel` for a solid and a dashed connector, so the dash comes from the style table in code |
| note fold | **resolved in §15 and corrected in §30**: the record reserves 15 px at the right of the caption (`_captionUIModel@width = w − 15`); the cut is 12 px and the text starts at 12, but **the 12 is the build's own number** — the record's `@side=12` is the placement code `SIDE_FREEMOVE`, not an inset (§30d) | the record stores no fold of its own — the note's `angle` (`v/cnk/hw.dq`) is 0 by default and no NOTE record writes it |
| note text inset | 12 px | the caption model has no such property: `ICaptionUIModel` is x, y, width, height, side, visible only (§30b). The build draws the text 12 px in and says so here instead of borrowing the record's `@side` |
| Interface / Enumeration defaults | Class defaults + fixed «interface» / «enumeration» line | the sampled projects contain no such shapes |
| gradient stops of the class fill | **resolved in §14**: `@type` is the switch — `1` solid, `2` gradient; every record here stores `@type=1`, so the fill is flat `@color1` and there are no stops. For `@type=2` the stops are `@color1 → @color2` along one of 16 directions with `cyclic=true` (`v/cmw/aw#a(...)`) | the record names the style but not the paint: the paint is built in code |

## 9. Two records that disagree, and which one we follow

| Key | 16.3 template (the person's) | 17.3 shipped sample | Our build |
|---|---|---|---|
| `paintConnectorThroughLabel` | `0` — the line **is** painted through the label (`paintThroughLabel.0` = "Yes", `v/cni/b#a+0x0564`) | `1` — the line is **not** painted through it, i.e. the label masks (`+0x0571` = "No") | `0`: follows the template the person works in — and the build's `label background hides the line` row is the `1` behaviour, so the two records differ here |
| `showMultiplicityConstraints` | `T` | `F` | `T`: multiplicities are always drawn |
| caption height | 14 | 15 | 14 |
| default font | Arial 11 | Dialog 11 | Arial 11 |

Where the two agree (grid, background, `visibilityStyle`, line model, fill
white, 1 px border) the value is safe.

## 10. Messages — `UserLanguage/Russian.lng`

The program's own Russian word table: 7 189 `<Word key="…" section="…"
value="\uXXXX…"/>` entries. The labels our build shows come from it, or from
the reference screenshot where the two disagree:

| Key | Section | Value in the file | Our UI |
|---|---|---|---|
| `File` | — | `Файл` | Файл |
| `Export` | General | `Экспорт` | Экспорт |
| `Grid` | Menu/View Menu | `Сетка` | Сетка |
| `Show Grid` | — | `Показать сетку` | Сетка (галочка) |
| `Model` | General | `Модель` | Модель |
| `Profile` | UML | `Профиль` | Профиль |
| `Stereotype` / `Stereotypes` | — | `Стереотип` / `Стереотипы` | Стереотип / Профиль |
| `Class` | — | `Класс` | Класс |
| `Interface` | — | `Интерфейс` | Интерфейс |
| `Package` | — | `Пакет` | Пакет |
| `Note` | Option Dialog | `Примечание` | Примечание |
| `Association` | — | `Ассоциация` | Ассоциация |
| `Generalization` | — | `Обобщение` | Обобщение |
| `Realization` | — | `Реализация` | Реализация |
| `Undo` / `Redo` | — | `Отменить` / `Вернуть` | Отменить / Вернуть |
| `Copy` / `Cut` / `Paste` / `Delete` | — | `Копировать` / `Вырезать` / `Вставить` / `Удалить` | same |
| `Zoom In` / `Zoom Out` / `Actual Size` | — | `Увеличить Масштаб` / `Уменьшить Масштаб` / `Фактический Размер` | Увеличить / Уменьшить / 100 % |
| `Edit` | General | `Редактирование` | Правка (**screenshot**, not this key) |
| `View` | Menu/View Menu | `Представление` | Вид (**screenshot**) |
| `Select` | Option Dialog | `Выбрать` | Выбор (**screenshot**) |

Two menu labels follow the reference screen rather than the table: the
screenshot is what the person sees in their own copy, and the table's
`Представление` / `Редактирование` are the raw keys for other sections.

## 11. Evidence trail

Every code fact above came from a Deep-mode call that left a record in
`investigation.cany/evidence/`:

| Call | Evidence id |
|---|---|
| `java_method_show v.dap.r#<clinit>` | `ev_6e2a5e2d7b79f352…` |
| `java_method_show v.dap.r#<init>` | `ev_aa2c66fa9051a326…` |
| `java_method_show v.dan.i#b` | `ev_4c8e447ce17e9471…` |
| `java_class_show com.vp.plugin.diagram.shape.IClassUIModel` | `ev_7bf19b5950394ba7…` |
| `core_target_open bin/Visual_Paradigm` | `t_8bad3bce780a` (kind `unknown`) |
| `core_target_open lib/lib01.jar` | `t_65f035fc7f57` (kind `jar`) |
| `java_class_users_find v.cmw.al` | `ev_d3e152dff99db25a…` (the `setLineStyle` bridge) |
| `core_target_open lib/vpplatform.jar` (§14 pass) | `t_21cb38990702` (kind `jar`, 87 531 369 B) |
| `native_strings_find` / `native_function_pseudocode` on that jar | refused: `not_supported: A Java program is not native machine code` — see §14d for the Java calls that answered instead |

§13 was read in a run of the same tool server started from the command line
(`craft-anything-cli java-method-show …`), which answers with the same records
but does not keep them in `investigation.cany/evidence/`. Its calls, by the
address they read:

| Call | What it settled |
|---|---|
| `java_method_show v.cco.b#e` | 45 arrow names → painter classes (§13a) |
| `java_method_show v.cco.a#<init>, #b, #c, #f, #g, #i, #p` | the head base: length `a`, width `b`, size code `x`, multipliers (§13b) |
| `java_method_show v.ccq.{bk,bb,a}#a(Graphics2D,Point2D,Point2D,DD)` | the three polygon formulas (§13c) |
| `java_method_show v.ccq.{n,h,c,q}#<init>` | the four heads' length/width/fill (§13d) |
| `java_method_show v.dal.au#<clinit>` | the 23 line styles and their dash arrays (§13e) |
| `java_method_show v.ber.e#setLineStyle` + `#a(LineStyle)` | `LineStyle` ordinal → `au.a[index]` (§13e) |
| `native_strings_find`, `native_functions_list` on the jar and on `bin/Visual_Paradigm` | `not_supported`, with the reason quoted in §0 — no machine code to search |

The record values come from two SQLite projects read read-only:
`~/Visual_Paradigm_CE_17.3/resources/BaggageSchemas.vpp` (shipped with
17.3) and `~/Загрузки/vp163template/myProject.vpp` (the person's 16.3
template). Nothing was written to either.


## 12. The other thirteen diagram types — what the program itself stores

Everything below was read from the person's own project
`~/Загрузки/vp163template/myProject.vpp` (SQLite, opened read-only:
`DIAGRAM`, `DIAGRAM_ELEMENT`, `MODEL_ELEMENT`) and from the shipped
`resources/BaggageSchemas.vpp`. A `.vpp` stores one `DEFINITION` text blob per
shape and per diagram; the keys below are the ones this build reproduces.

### 12a. Diagram types present in the person's project

| `DIAGRAM.DIAGRAM_TYPE` | count | shapes it actually contains |
|---|---|---|
| `ClassDiagram` | 12 | Class, Dependency, Generalization, Realization, Association, BindingDependency |
| `InteractionDiagram` | 8 | Message, Activation, InteractionLifeLine, LostFoundMessageEnd, InteractionOperand, CombinedFragment, Anchor, NOTE, InteractionActor |
| `PackageDiagram` | 3 | Package, Import |
| `CompositeStructureDiagram` | 2 | StructuredConnector, Part, Collaboration2 |
| `ComponentDiagram` | 1 | Component |
| `DeploymentDiagram` | 1 | Node, Artifact, Deployment |
| `UseCaseDiagram` | 1 | Actor, UseCase |

`MODEL_ELEMENT.MODEL_TYPE` is the metamodel type and is shared by every
diagram: the same `Class` row is drawn on a Class and on a Composite Structure
diagram. That is the record-level proof of «элемент в модели, вид на
диаграмме», and why this build keeps elements/relationships in the model and
only geometry + `elementId` on a diagram.

### 12b. Interaction diagram (Sequence) — its own layout options

`DIAGRAM.DEFINITION` for `InteractionDiagram` carries
`_interactionDiagramLayoutOptions`:

| Key | Value | Used for |
|---|---|---|
| `@absoluteLifelineSpacingDistance` | `80` | `LIFELINE_GAP` in geometry.js |
| `@absoluteMessageSpacingDistance` | `30` | `MESSAGE_GAP`, default y step of a new message |
| `@handleLabelsWhenLayout` | `T` | label follows the message |
| `showSequenceNumbers` | `F` | numbers are drawn because a message is a sequence message, not because a flag is on |
| `showActivations` | `F` | activation bars are explicit shapes, not automatic |
| `autoExtendActivations` | `T` | an activation grows when a message lands on it |
| `showMessageStereotype` | `T` | «create»/«destroy» above the arrow |
| `showMessagesOperationSignature` | `T` | `name()` printed with parentheses |
| `interactionLifeLinePresentationOption` | `1` | object lifeline (rectangle head) |
| `displayLifeLinesAsRobustnessAnalysisIcon` | `1` | icon mode for analysis |

### 12c. Shape sizes read out of the records

| Shape | `width` | `_captionUIModel @height` | Source row |
|---|---|---|---|
| `InteractionLifeLine` | 120 | 14 | `DIAGRAM_ELEMENT` `IP9gMyKGAqACZhRq` |
| `Activation` | 8 | 12 (hidden) | `gY2n0yKGAqACZgfu` |
| `CombinedFragment` | 500 | 18 | `2vhX0yKGAqACZghc` |
| `InteractionActor` | 60 | 14 | `oxM5bAaGAqAEHzYr` |
| `Part` | 120 | 14 | `8zFZ0yKGAqACZhPh` |
| `Collaboration2` | 550 | 36 | `aABbUyKGAqACZgrJ` |
| `Message` | 91 | 16 | `ltnb0yKGAqACZgXr` |
| `Package` | 140 | 80 (tab+body) | `OAG1TeqGAqACAwZ8` |
| `NOTE` (in a sequence) | 80 | 0, side 12 | `KqAX0yKGAqACZggw` |

The lifeline **head height** is not stored — the record only has the caption
(14). This build draws a 40 px head (two caption lines: «stereotype» + name)
and 70 px for an actor lifeline; both are marked `estimated` in
`mechanics.json` because the number is a decision, not a measurement.

### 12d. What each type's palette offers — from the API, not invented

`openapi.jar!com/vp/plugin/diagram/IShapeTypeConstants` declares 546 shape
types. The UML ones this build exposes are exactly the constants whose names
the UML metamodel uses (`Class`, `Interface`, `Actor`, `UseCase`, `Node`,
`Artifact`, `Component`, `Part`, `Port`, `Collaboration2`, `InitialNode`,
`ActivityFinalNode`, `DecisionNode`, `ForkNode`, `JoinNode`, `ActivityAction`,
`ActivitySwimLane`, `ObjectNode`, `InteractionLifeLine`, `InteractionActor`,
`Activation`, `CombinedFragment`, `Message`, `Transition2`, `State2`,
`Association`, `Generalization`, `Realization`, `Dependency`, `Usage`,
`Import`, `Include`, `Extend`, `Deployment`, `StructuredConnector`).
`openapi.jar!com/vp/plugin/diagram/IDiagramTypeConstants` gives the 14 diagram
constants reproduced in `notation/uml.json` (`ClassDiagram` …
`InteractionOverviewDiagram`), including `InteractionDiagram` for Sequence.

### 12e. Decisions this build had to make (no key in the original)

| Decision | Why | Where |
|---|---|---|
| A message's order is its `y`; numbers are derived | the record stores geometry only; VP's own layout sorts messages by y | `render.js#messageNumbers`, canvas `message` drag |
| Deleting a shape removes its link views but keeps the relationship | `DIAGRAM_ELEMENT` and `MODEL_ELEMENT` are separate tables | `model.js#removeShape` / `removeRelationship` |
| Deleting an element deletes the diagrams it owns | `DIAGRAM.PARENT_MODEL_ID` points at a model element | `model.js#removeElement` |
| Timing diagram segments are `{state, from, to}` in percent | the timing record stores state rows per lifeline; a percentage scale is the smallest editable form | `notation/uml.json` `timingLane`, `model.js#timeline` |
| Stereotype applicability is a convenience group, not a restriction | VP allows applying almost any stereotype; the profile's `baseType` only sorts | `io/stereotypes.js#APPLICABILITY` |

### 12f. Routing and label decisions after the visual pass

| Decision | Why | Where |
|---|---|---|
| Two facing sides are joined by one straight run | the rectilinear mid-elbow produced 20 px jogs and a trunk that doubled a system boundary's border; a straight line is the same UML and reads as intended | `geometry.js#routePoints` |
| A connector label sits at half the whole route's length, 12 px above the line | an elbow's longest run is often vertical, and a guard («да») turned 90° is unreadable; the reference keeps guards horizontal and above the line. Round 7 replaced "the longest horizontal segment" with the midpoint **by path length** when a link has bends, or a U-turn put the label on the way out — §18e. **Round 14**: the *turn* of the text is `connectorLabelOrientation`, and the program's default is 0 = "Horizontal Only" (§24d), so a label stays flat unless a connector asks for 1–3 | `geometry.js#labelPos`, `model/connector-style.js#labelAngle`, `render.js#renderLink` |
| A system boundary and a swimlane are painted before the links | both are filled frames: drawn after, their white fill hid every association crossing them | `render.js#renderDiagram` |
| A decision's minimum width is twice its name | the inscribed rectangle of a diamond is half its width, so `textWidth + 40` keeps the name inside the rhombus | `geometry.js#layoutOf` |
| An actor's bounding box stays 40 px wide while its name may overflow | otherwise a connector anchors on empty space beside the stick figure | `geometry.js#layoutOf` |

## 13. Connector heads and line styles — the painters, decompiled

Everything in §8 that was a placeholder for an arrowhead or a dash pattern is
replaced here by the program's own arithmetic. The arrowheads are **not** in
the records (§5e) and **not** in a resource: `vpplatform.jar` carries an empty
`resource/arrow/` folder, and the shapes are built from code.

### 13a. The registry — `vpplatform.jar!v/cco/b#e()V`

193 instructions, `+0x0004 … +0x03f0`: 45 `a("Name", painter.class)` calls.
This is the only place the arrow names exist as strings (a byte scan of all
35 230 classes finds `"SolidArrow1"` and `"HollowDiamond"` in this class
alone). The public API mirrors it: `openapi.jar!com/vp/plugin/diagram/connector/IArrowHead`
declares `ARROW_*` string constants with exactly these values, and the seven
size codes `SIZE_VERY_SMALL=0 … SIZE_COLOSSAL=6`.

| Name | Painter | Name | Painter |
|---|---|---|---|
| `None` | `v/ccq/b` | `HollowArrow3` | `v/ccq/j` |
| `Arrow1` | `v/ccq/c` | `HollowArrowArc1` | `v/ccq/k` |
| `SolidArrow1` | `v/ccq/n` | `HollowArrowArc2` | `v/ccq/l` |
| `Arrow2` | `v/ccq/y` | `HollowArcArrow` | `v/ccq/m` |
| `SolidArrow2` | `v/ccq/aj` | `HollowCircle1` | `v/ccq/o` |
| `SolidArrowArc1` | `v/ccq/aq` | `HollowRectangle` | `v/ccq/p` |
| `SolidArrowArc2` | `v/ccq/ar` | `HollowDiamond` | `v/ccq/q` |
| `ArcArrow` | `v/ccq/as` | `SlopeLine2` | `v/ccq/r` |
| `SolidArcArrow` | `v/ccq/at` | `OneStraightLine` | `v/ccq/s` |
| `SlopeLine1` | `v/ccq/au` | `TwoStraightLine` | `v/ccq/t` |
| `SolidCircle1` | `v/ccq/d` | `ThreeStraightLine` | `v/ccq/u` |
| `SolidRectangle` | `v/ccq/e` | `Shrink` / `ShrinkOneLine` / `ShrinkCircle` | `v/ccq/v,w,x` |
| `Arrow3` | `v/ccq/f` | `StraightCircle` | `v/ccq/z` |
| `SolidArrow3` | `v/ccq/g` | `CircleOne/Two/ThreeStraightLine` | `v/ccq/aa,ab,ac` |
| `HollowArrow1` | `v/ccq/h` | `CircleDiamond` | `v/ccq/ad` |
| `HollowArrow2` | `v/ccq/i` | `SolidCircleOne/Two/ThreeStraightLine` | `v/ccq/ae,af,ag` |
| `DoubleSolidArrow` | `v/ccq/ai` | `SolidCircleDiamond` | `v/ccq/ah` |
| `DoubleHollowArrow` | `v/ccq/ak` | `HollowCircle2` / `SolidCircle2` | `v/ccq/al,am` |
| `DoubleArrow` | `v/ccq/an` | `ArrowOneStraightLine` | `v/ccq/ao` |
| | | `DoubleArrowOneStraightLine` | `v/ccq/ap` |

### 13b. The shared base — `v/cco/a#<init>(Ljava/lang/String;)V`

| Field | Getter | Default | Meaning |
|---|---|---|---|
| `a` | `i()` | `20` | length along the line |
| `b` | `g()` | `15` | full width across it |
| `x` | `f()` | `2` | size code = `SIZE_MEDIUM` |
| `v` | `p()` | `1.0f` | scale multiplier |
| `k[7]` | — | all `1.0` | length multipliers per size code |
| `l[7]` | — | all `1.0` | width multipliers per size code |
| `n` | `h()` | `Color.black` | outline colour |
| `v` | `j()` | `1.0f` | stroke weight |

`b(I)V` writes the **width** (`this.b`), `c(I)V` writes the **length**
(`this.a`); each is a no-op when the value is unchanged. A head's constructor
therefore reads as "width, then length, then filled?".

### 13c. The three painters — exact polygons

All three are handed the tip point and `(length, width)`; each builds its
`GeneralPath` in a frame whose `+y` runs **back along the line** (the caller
rotates the `Graphics2D` first), so the numbers below are literal.

| Painter | Path |
|---|---|
| `v/ccq/bk#a(Graphics2D,Point2D,Point2D,DD)V` — triangle | `(x, y) → (x + w/2, y + len) → (x − w/2, y + len) → close`; filled when `r()` is true, stroke `BasicStroke(j())` |
| `v/ccq/bb#a(…,DD)V` — diamond | `(x, y) → (x + w/2, y + len/2) → (x, y + len) → (x − w/2, y + len/2) → close` |
| `v/ccq/a#a(…,DD)V` — open arrow | two `Line2D`: `(x − w/2, y + len) → (x, y)` and `(x + w/2, y + len) → (x, y)`; never filled |

Every painter ends with `a(f()*k[size])` for the length and
`a(g()*l[size])` for the width — e.g. `v/ccq/n#a`:

    v6 = k[f()] * p();  v8 = l[f()] * p();
    paint(g, from, to, v6 * i(), v8 * g());      // length = k·a, width = l·b

### 13d. The four heads this build uses, with their own numbers

| Head | Class · offsets | length | width | fill | `k[]` (length by size 0…6) | `l[]` (width by size 0…6) |
|---|---|---|---|---|---|---|
| `HollowArrow1` | `v/ccq/h#<init>` `+0x0085 bipush 8` (c), `+0x008b bipush 11` (b), `+0x0080 a(0)` | 8 | 11 | hollow | 0.7, 0.8, 1, 1.2, 1.4, 2.7, 5.1 | 0.714, 0.857, 1, 1.214, 1.429, 2.857, 5.429 |
| `SolidArrow1` | `v/ccq/n#<init>` `+0x0006 iconst_4` (b), `+0x000b bipush 7` (c), `+0x0011 a(1)` | 7 | 4 | solid | 0.667, 0.778, 1, 1.222, 1.444, 2.889, 5.556 | 0.8, 0.8, 1, 1.2, 1.4, 2.8, 5.2 |
| `Arrow1` | `v/ccq/c#<init>` `+0x0006 iconst_4` (b), `+0x000b bipush 8` (c) | 8 | 4 | open | 0.7, 0.8, 1, 1.2, 1.4, 2.7, 5.1 | 0.833, 0.833, 1, 1.167, 1.333, 2.5, 4.5 |
| `HollowDiamond` | `v/ccq/q#<init>` `+0x0012 bipush 8` (c), `+0x0018 bipush 16` (b), `+0x001e a(0)` | 8 | 16 | hollow | 0.727, 0.818, 1, 1.182, 1.455, 2.818, 5.273 | 0.667, 0.810, 1, 1.190, 1.429, 2.857, 5.429 |

At the default size code 2 (`SIZE_MEDIUM`) both multipliers are 1.0, so the
drawn head is exactly *length × width*: 8×11, 7×4, 8×4, 8×16. A size change
multiplies these two numbers and nothing else.

### 13e. Line styles — `vpplatform.jar!v/dal/au#<clinit>()V`

485 instructions building `static BasicStroke[] a` with **23 entries**, indexed
by `LineStyle` ordinal (`openapi.jar!com/vp/plugin/diagram/format/LineStyle` =
`None`, `Style1 … Style22`). `v/ber/e#a(LineStyle)` maps ordinal → index with a
23-way switch (identity; `default` → 1) and `v/ber/e#setLineStyle` does
`this.a.a(au.a[index])`. The factory `v/dal/au#a([F)Ljava/awt/BasicStroke;` is

    new BasicStroke(1.0f, 0 /* CAP_BUTT */, 1 /* JOIN_ROUND */, 0.0f, dash, 0.0f)

| Index | `LineStyle` | Dash array |
|---|---|---|
| 0 | `None` | `null` (no stroke) |
| 1 | `Style1` | `1.0` → solid |
| 2 | `Style2` | **`8, 5`** |
| 3 | `Style3` | `1, 5` (dots) |
| 4 | `Style4` | `8, 5, 1, 5` (dash-dot) |
| 5 | `Style5` | `8, 5, 1, 5, 1, 5` (dash-dot-dot) |
| 6 | `Style6` | `8, 4, 8, 5, 1, 5` |
| 7 | `Style7` | `20, 5, 4, 5` |
| 8 | `Style8` | `20, 5, 4, 5, 4, 5` |
| 9 | `Style9` | `4` |
| 10 | `Style10` | `1, 3` |
| 11 | `Style11` | `4, 3, 1, 3` |
| 12 | `Style12` | `4, 3, 1, 3, 1, 3` |
| 13 | `Style13` | `4, 3, 4, 3, 1, 3` |
| 14 | `Style14` | `10, 3, 2, 3` |
| 15 | `Style15` | `10, 3, 2, 3, 2, 3` |
| 16 | `Style16` | `16, 9` |
| 17 | `Style17` | `1, 9` |
| 18 | `Style18` | `16, 9, 1, 9` |
| 19 | `Style19` | `16, 9, 1, 9, 1, 9` |
| 20 | `Style20` | `16, 9, 16, 9, 1, 9` |
| 21 | `Style21` | `40, 9, 8, 9, 7, 9` |
| 22 | `Style22` | `2` |

The project file can override this per project:
`MODEL_ELEMENT` type `ProjectDefaultLineModel` carries
`lineModelStrokeDashs`; both projects on this machine store `12, 6, 2, 6`
(a dash-dot that is not one of the 23 presets), so the preset table is the
default and the record is the override.

### 13f. What the build now takes from §13

| Value | Number | Where it is used |
|---|---|---|
| hollow triangle head | 8 long × 11 wide | `geometry.js#HEAD_TRI/HEAD_TRI_W` → `render.js#renderHead('triangle')` — generalization, realization |
| solid head | 7 × 4 | `HEAD_SOLID/HEAD_SOLID_W` → `renderHead('filledTriangle')` — composition's end, filled arrows |
| open head | 8 × 4 | `HEAD_OPEN/HEAD_OPEN_W` → `renderHead('open')` — dependency, usage, import, merge, include, extend |
| diamond head | 8 long × 16 wide | `HEAD_DIAMOND/HEAD_DIAMOND_W` → `renderHead('diamond'/'filledDiamond')` — aggregation, composition |
| dashed line | `8 5` | `DASH` → `.conn.dash`, `.sh-dash`, `.sh-body.dash` (export stylesheet and `--dash` in `styles.css`) |

Before this pass the build drew a 16×12 triangle, a 10 px open arrow whose
barbs spread `HEAD_OPEN/2 = 5` each side, an 18×14 diamond, and `6 4` dashes —
all four were placeholders and all four are now the program's numbers.

## 14. Заливка фигуры — сплошная и градиент (`v/cmo/qd` → `v/cmw/i` → `v/cmw/aw`)

The record stores a fill as four fields and no paint:

```
_fillColor=(@gradientStyle=1; @transparency=0; @type=1; @color1=(122,207,245,255))
```

Four decompile steps turn that into pixels. `+0x` is the bytecode offset in the
named method; the class files are in `lib01.jar` unless another jar is named.

| Step | Call | What it says |
|---|---|---|
| 1 | `v/cmo/qd#az()` | the element's fill model — `v/cmw/i` |
| 2 | `v/cmw/i#<clinit>` | type constants `a = 1` (solid), `b = 2` (gradient), `c = 100`, `d = 0` |
| 3 | `v/cmw/i#<init>` | defaults: type (`e`) = **1**, gradientStyle (`h`) = **0**, (`i`) = 1, alpha (`j`) = **255** |
| 4 | `v/cmw/aw#a(Lv/byf/cn;Ljava/awt/Rectangle;)Ljava/awt/Paint;` | the decision below |
| 5 | `v/cmw/aw#a(ILjava/awt/Rectangle;Ljava/awt/Color;Ljava/awt/Color;)Ljava/awt/GradientPaint;` | the 16 directions below |

### 14a. The decision — `v/cmw/aw#a(cn, Rectangle)`, 52 bytes

| Offset | Test | Result |
|---|---|---|
| `+0x0006` | `cn.a()` — the type | read once |
| `+0x000c` | type **== 2** | with `rect != null` (`+0x0011`) call `aw.a(cn.d(), rect, cn.b(), cn.c())` at `+0x0021` → `GradientPaint` |
| `+0x0029` | type **== 1** | load `cn.b()` (`+0x002e`) → that Colour itself |
| otherwise | — | `null`: the shape is not filled |

`cn.b()` is `@color1`, `cn.c()` is `@color2`, `cn.d()` is `@gradientStyle`.
**`@type = 1` is the switch, not `@gradientStyle`:** every class-diagram record
in this install stores `@type=1` with `@gradientStyle=1`, so those shapes are
painted **flat `@color1`** — `#7acff5` for VP's own default, white in the
sampled templates. That is why §8 could not find "gradient stops": with
`@type=1` there are none. The build was already right to paint flat; what was
missing was the rule that says so, and the case `@type=2`.

How the model reaches the style: `v/civ/h#<init>(Lv/cmo/gj;)V` at `+0x00b4`
reads `v.cmo.qd.az()` into `v.cmw.i`, then `+0x00c5`/`+0x00ce` copy `b()`/`c()`
into `cn.a(Color)`/`cn.b(Color)`, and `+0x00d7` puts `aw.a(i.h())` into
`cn.a(int)` — the gradient style, clamped by `v/cmw/aw#a(I)I` (181 bytes), which
lets **1…16** through unchanged and leaves anything else as it is.

### 14b. The 16 directions — `v/cmw/aw#a(I,Rectangle,Color,Color)`, 614 instructions

`vpplatform.jar!v/cqk/bz#a` with the same signature holds the identical
614-instruction body (the gradient preview in the colour chooser). With the
box `(x, y, w, h)`, `cx = x + w/2`, `cy = y + h/2`:

| Style | from | to | direction |
|---|---|---|---|
| 1 | (cx, y+h) | (cx, y) | снизу вверх |
| 2 | (cx, y) | (cx, y+h) | сверху вниз |
| 3 | (cx, cy) | (cx, y) | из центра вверх |
| 4 | (cx, y) | (cx, cy) | сверху в центр |
| 5 | (x+w, cy) | (x, cy) | справа налево |
| 6 | (x, cy) | (x+w, cy) | слева направо |
| 7 | (cx, cy) | (x, cy) | из центра влево |
| 8 | (x, cy) | (cx, cy) | слева в центр |
| 9 | (x+w, y+h) | (x, y) | ↖ |
| 10 | (x, y) | (x+w, y+h) | ↘ |
| 11 | (cx, cy) | (x, y) | из центра в левый верхний |
| 12 | (x, y) | (cx, cy) | из левого верхнего в центр |
| 13 | (x, y+h) | (x+w, y) | ↗ |
| 14 | (x+w, y) | (x, y+h) | ↙ |
| 15 | (cx, cy) | (x, y+h) | из центра в левый нижний |
| 16 | (x, y+h) | (cx, cy) | из левого нижнего в центр |

Every branch ends at `+0x04bc` with
`new GradientPaint(p1, color1, p2, color2, true)` — `iconst_1` at `+0x04c6` is
`cyclic = true`. So a half-box style (3, 4, 7, 8, 11, 12, 15, 16) is **not** a
fade across the whole shape: it mirrors at the centre line.

### 14c. What the build now takes from §14

| Value | Number | Where it is used |
|---|---|---|
| `fill type solid` | 1 | `src/model/fill.js#FILL_SOLID` ← `MECHANICS.fillTypeSolid` |
| `fill type gradient` | 2 | `fill.js#FILL_GRADIENT` ← `MECHANICS.fillTypeGradient` |
| `gradient directions` | 16 | `fill.js#GRADIENT_STYLES`; a mismatch with the sheet throws at load |
| `gradient cyclic` | `true` | `fill.js#GRADIENT_SPREAD` = `reflect` — the SVG twin of `GradientPaint(..., true)` |

Two representations, one rule: a shape's `fill` is either a colour string
(solid — how the samples and older project files store it) or
`{ type, color1, color2, style }`, the four fields of the record.
`fill.js#fillOf` reads both. `render.js#applyFill` then either sets the colour
or writes a `<linearGradient>` into the sheet's `<defs>` with the numbers from
14b in `objectBoundingBox` units (the same fractions of the same box) and
`spreadMethod` from `GRADIENT_SPREAD`. `panels.js` shows a gradient switch and
sixteen direction buttons whose background is the gradient itself, so the
picture on the button is the picture on the shape. `io/umljson.js#readFill`
accepts both forms on load and repairs anything else to a solid colour.

### 14d. Evidence

| Call | Evidence id |
|---|---|
| `java_class_show v/cmw/aw` | `ev_262dbfd459453d…` |
| `java_class_show v/cmw/i` | `ev_d44a40b1f7b001…` |
| `java_method_show v/cmw/i#<init>()V` | `ev_2625a1252f8f7b…` |
| `java_method_show v/cmw/aw#a(cn,Rectangle)→Paint` | `ev_bb48aa3510a9af…` |
| `java_method_show v/cmw/aw#a(I,Rectangle,Color,Color)` | `ev_1bd70f42df5e13…` |
| `java_method_show v/cmw/aw#a(I)I` | `ev_459221bca0699c…` |
| `java_method_show v/cqk/bz#a(I,Rectangle,Color,Color)` | `ev_9125aa461ebe06…` |
| `java_method_show v/cqk/bz#a(Graphics2D)` | `ev_05f2f695223d6f…` |
| `java_class_show v/cil/a` (fill-style enum) | `ev_48252448eb7b2d…` |
| `java_method_show v/cil/a#a(I)` | `ev_5ba537e3925d5e…` |
| `java_class_show v/dps/d` (the serialiser's key table) | `ev_8c6d9dc4281966…` |

## 15. The note — 834 shape types, and where its 12 px comes from

§8 carried one open row: «note fold — 12 px, placeholder». This pass followed it
into the code. The native tools were tried first and refused exactly as in §0
(`not_supported: A Java program is not native machine code`); everything below
is bytecode, read with `java_method_show` / `java_class_show`.

### 15a. The registry: every shape type → the model class it builds

`vpplatform.jar!v.mm#initDiagramElementClassTable()V` — **3 337 instructions,
834 entries**, one per shape type. Every entry is the same four instructions:

```
aload_0
ldc  "NOTE"            // the shape type
ldc  "v.cnk.ach"       // the model class it instantiates
invokevirtual v.mm.registerUIModelClass(String,String)V
```

The offsets in the table are the bytecode offset of each entry's `aload_0`:

| Shape type | Model class | At |
|---|---|---|
| `Class` | `v.cnk.vd` | `+0x0780` |
| `InterfaceClass` | `v.cnk.abf` | — |
| `Enumeration` | `v.cnk.zf` | `+0x0adc` |
| `DataType` | `v.cnk.yd` | — |
| `Package` | `v.cnk.acw` | `+0x0f55` |
| `NOTE` | `v.cnk.ach` | `+0x0e48` |
| `Component` | `v.cnk.wo` | — |
| `Actor` | `v.cnk.no` | — |
| `UseCase` | `v.cnk.aju` | — |
| `State` | `v.cnk.agb` | — |
| `Association` | `v.cmq.cu` | `+0x1975` |
| `Dependency` | `v.cmq.eh` | `+0x1b55` |
| `Generalization` | `v.cmq.eu` | `+0x1c31` |
| `Realization` | `v.cmq.gf` | `+0x1dfd` |

Two things this settles:

- an **interface is not a class** in 17.3: `InterfaceClass` → `v.cnk.abf`, a
  different model class from `Class` → `v.cnk.vd`. The build draws both from
  one compartment engine, which is a shortcut, not the original's shape.
- `DeviceNode` and `ExecutionEnvironmentNode` both point at `v.cnk.ace` — the
  same class as `Node`; the three differ by a property, not by class.

The whole table is saved as `app/notation/shape-types.json` (834 rows, the jar's
sha256, and the method it came from) and `app/tests/shape-types.mjs` re-reads it
against the jar: 22 checks, including the nine rows above.

Six shapes the build draws have **no type of their own** in the registry:
`profile`, `object`, `collaborationUse`, `metaclass`, `systemBoundary`,
`interactionUse`. The original keeps them as another type plus a property
(a profile is a package, a system boundary is a primitive shape), which is why
`Profile`, `Object`, `Metaclass`, `CollaborationUse` and `InteractionUse` are
absent from the 834 names.

### 15b. The note's chain, and its angle

| Step | Where | What it says |
|---|---|---|
| type → model | `v.mm#initDiagramElementClassTable+0x0e48` | `NOTE` → `v.cnk.ach` |
| model → base | `java_class_show v.cnk.ach` | extends `v.cnk.hw`, no fields of its own, 7 methods |
| the angle field | `v.cnk.hw` fields | `dq = "angle"` (the property key), `dr = int` (the value) |
| its default | `v.cnk.hw#<init>()V` (7 instructions) | `ldc "NOTE"` → `v.cmo.qd.<init>(String)` → `iconst_0` → `putfield dr` — **angle 0** |
| its getter | `v.cnk.hw#b()I` | `getfield dr; ireturn` |
| the API | `openapi.jar!com/vp/plugin/diagram/shape/INoteUIModel` | exactly `PROPERTY_ANGLE = "angle"`, `getAngle()I`, `setAngle(I)V` |
| the bridge | `lib01.jar!v.bet.kw` (implements `INoteUIModel`) | `getAngle()` = `this.c.p("7UdFrDg2Pl"); return this.c.b();` — `p(...)` is the change notification, the value is `b()` |

So a note has an angle, its default is **0**, and **no NOTE record writes it**:
the five notes in `myProject.vpp` list `_captionUIModel`, `_elementFont`,
`_fillColor`, `_lineModel`, `_parent`, `background`, `connectToPoint`,
`creatorDiagramType`, `foreground`, `height`, `metaModelElement`,
`overrideAppearanceWithStereotypeIcon`, `parentConnectorHeaderLength`,
`parentConnectorLineLength`, `width`, `x`, `y` — and no `angle`.

### 15c. What the five NOTE records do store

| width | height | caption `@width` | caption `@side` | caption `@height` |
|---|---|---|---|---|
| 80 | 70 | 65 | 12 | 0 |
| 140 | 60 | 125 | 12 | 0 |
| 90 | 40 | 75 | 12 | 0 |
| 80 | 40 | 65 | 12 | 0 |
| 80 | 40 | 65 | 12 | 0 |

Two constants and one rule, in every one of them:

- `@side = 12` — **corrected in §30d**: this is the placement code
  `SIDE_FREEMOVE`, not an inset. The caption is free to sit anywhere inside the
  shape, which is why its box starts at `0,0`; the text inset the build draws
  is its own number (§8);
- `@width = shape width − 15` — the caption box is 15 px narrower than the
  shape (80→65, 140→125, 90→75), which is the 12 px cut plus a 3 px gap;
- `@height = 0` — the caption has no height of its own, it follows the text.

### 15d. What the build now takes from §15

| Value | Number | Used by |
|---|---|---|
| `note caption side` | 12 — **corrected in §30d**: a placement code (`SIDE_FREEMOVE`), not a distance | `geometry.js#CAPTION_SIDE_FREEMOVE`; the note's text inset is now its own sheet value `note text inset` (§30f) |
| `note caption width delta` | 15 | `geometry.js#NOTE_CAP_DELTA` — text wraps to `w − 15 − 12`; the cut is `min(12, w − 15)` |

Before this pass the note was drawn with three numbers that appear in no record
and in no function: text at `PAD_X` = 8 (the generic compartment padding), wrap
at `w − 2·8 − 12/2` = `w − 22`, cut at `min(12, w/3)`. Now all three come from
the two sheet values above, which come from the five records.

**The honest limit.** The function that *paints* the corner was not found: the
note's view (`v.cmn.al#a(v.cmo.ii, v.cmn.bi, v.dvk.i)V`, 31 instructions) only
builds the model from the record and hands it to the generic shape view, and no
class that holds a `v.cnk.ach` references `Path2D` or `GeneralPath`. So the 12
px inset and the 15 px delta are **read**; «the cut is exactly 12» is an
inference from the 15 = 12 + 3 split. It is the same 12 the record stores, and
it replaces a number that came from nowhere.

### 15e. Evidence

| Call | Evidence id |
|---|---|
| `java_method_show v.mm#initDiagramElementClassTable` (3 337 instr.) | `ev_77f612ffa9706fcd…` |
| `java_method_show v.cnk.hw#<init>` | `ev_b7dd6d6d747fe8a3…` |
| `java_method_show v.bet.kw#getAngle` | `ev_a282e28443c42afa…` |
| `java_method_show v.cmn.al#a(v.cmo.ii,v.cmn.bi,v.dvk.i)` | `ev_b5487bee00da3000…` |
| `java_class_show com.vp.plugin.diagram.shape.INoteUIModel` | `ev_6f0150c7052baf35…` |
| `java_class_show v.cnk.ach` | `ev_4d7bf80a563a9479…` |

## 16. The native pass on the main program — and the enum it uncovered

This pass was asked for as "open the main program, find the functions with
`native_strings_find`, read each with `native_function_pseudocode`". It was run
exactly that way. §16a is what came back, verbatim; §16b is the code that could
answer instead; §16c is the value it corrected.

### 16a. The calls and their answers

| Call | Target | Result |
|---|---|---|
| `core_target_open --path …/bin/Visual_Paradigm` | the main program | `{"bytes":17166,"description":"A file we don't recognise yet","kind":"unknown","name":"Visual_Paradigm",…,"sha256":"8bad3bce780a06a8…"}` → target `t_8bad3bce780a` |
| `native_strings_find …/bin/Visual_Paradigm --pattern AlignToGrid` | same | `not_supported: Couldn't read this as a program: the file is malformed (Unknown file magic)` |
| `native_functions_list …/bin/Visual_Paradigm` | same | the same `not_supported`, same message |
| `native_function_pseudocode …/bin/Visual_Paradigm --function 0x1000` | same | the same `not_supported`, same message |
| `native_strings_find …/lib/vpplatform.jar --pattern Visibility` | the code jar | `not_supported: A Java program is not native machine code.` |
| `native_function_pseudocode …/lib/vpplatform.jar --function 0x1000` | the code jar | same `not_supported` |
| `native_function_pseudocode …/lib/lib01.jar --function 0x1000` | the second code jar | same `not_supported` |
| **control** `core_target_open …/jre/bin/java` | the JVM shipped in the same folder | `{"bytes":12768,"description":"A Linux (or Unix) program","kind":"elf",…}` → `t_e94ab2b5afc1` |
| **control** `native_strings_find …/jre/bin/java --pattern Visibility` | same | ran: `{"matches":[],"total":0}`, evidence `ev_55c0029797761ffc…` |
| **control** `native_functions_list …/jre/bin/java` | same | ran: **24 functions**, first `_init` at `0x8c0` (6 instructions, found by symbol), `ev_7e658ad6adbe7b30…` |
| **control** `native_function_pseudocode …/jre/bin/java --function 0x8c0` | same | ran: *"Pseudo-C for _init (7 lines)"*, `ev_e2135a87733100…` |

Two separate facts, and they must not be confused:

1. **The native toolset works.** The control reads an ELF from the very same
   install folder and returns a function table and pseudo-C with symbols.
2. **The program the person runs is not machine code.** `bin/Visual_Paradigm`
   is a 17 166-byte install4j *POSIX shell script*; everything behind it is
   `lib/*.jar`. `native_strings_find` has no data section to search and
   `native_function_pseudocode` has no machine-code unit to lift — there is no
   address space here, so there is no native address to put in this sheet.
   Every address in §1–§15 is therefore `jar!class#method + bytecode offset`,
   which is where a JVM keeps its code.

### 16b. What answered, and the codes it gave

`openapi.jar!com/vp/plugin/diagram/shape/IClassUIModel#<clinit>` — 175
instructions, four arrays built and `putstatic`'d:

| Offset | Instruction | Meaning |
|---|---|---|
| `+0x0006` | `ldc "Icon"` | `VISIBILITY_STYLES[0]` |
| `+0x000b` | `ldc "UML"` | `VISIBILITY_STYLES[1]` |
| `+0x0010` | `ldc "Off"` | `VISIBILITY_STYLES[2]` |
| `+0x0013` | `putstatic …VISIBILITY_STYLES` | the menu, index by index |
| `+0x001c` / `+0x0021` / `+0x0026` | `ldc "Hide all"` / `"Show all"` / `"Show public only"` | `SHOW_ATTRIBUTE_OPTIONS` (putstatic `+0x0029`); `SHOW_OPERATION_OPTIONS` and `SHOW_RECEPTION_OPTIONS` are the same three strings at `+0x002c…+0x0055` |

The same interface's fields are the codes themselves: `VS_ICON = 0`,
`VS_UML = 1`, `VS_OFF = 2`. The bridge
`lib01.jar!v/bet/gg#getVisibilityStyle()I` (`ev_9d54ffaf00af5a48…`) reads the
stored int and nothing else:

```
aload_0; getfield c : v.cnk.vd ; pop ; ldc "7UdFrDg2Pl" ; invokevirtual p(String)V   // change notification
aload_0; getfield c : v.cnk.vd ; invokevirtual hV_()I ; ireturn                      // the value
```

So the property value is an **index into `VISIBILITY_STYLES`**:

| Value | Meaning | Who stores it |
|---|---|---|
| `0` | **Icon** — a painted glyph | nothing in the samples; the API default for a shape that never sets the property |
| `1` | **UML** — the `+ - # ~` character | the factory default `ClassVisibilityStyle` (`v/dap/r#<init>+0x0030`) and `visibilityStyle=1` in every class record read here |
| `2` | **Off** — nothing drawn | nothing in the samples |

### 16c. The correction this forced

§4 and §7 used to say "1 = icons, anything else the characters", and
`render.js#renderVisibilityIcon` was written exactly that way: at the value
every record actually stores (1) it painted a glyph, and it had no "off" at
all. The interface says the opposite, index by index — 1 is `"UML"`.

| Now | Where |
|---|---|
| `VIS_ICON = 0`, `VIS_UML = 1`, `VIS_OFF = 2` | `src/model/geometry.js` ← `mechanics.json` "visibility style icon / uml / off" |
| 0 → glyph, 1 → character, 2 → nothing | `src/ui/render.js#renderVisibilityIcon` |
| the two icon colours stay `estimated: true` and are reachable only in state 0 | `mechanics.json` "visibility icon protected/package colour" |

The same `<clinit>` also explains the reader's three-way mapping in §2:
`10 → 0` "Hide all", `11 → 1` "Show all", `12 → 2` "Show public only".

### 16d. Evidence

| Call | Evidence id |
|---|---|
| `java_class_show com.vp.plugin.diagram.shape.IClassUIModel` (the `VS_*` field constants) | `ev_086811a608787652…` |
| `java_method_show IClassUIModel#<clinit>` (175 instructions) | `ev_1fc158623886a16d…` |
| `java_method_show v/bet/gg#getVisibilityStyle` | `ev_9d54ffaf00af5a48…` |
| `native_functions_list jre/bin/java` (control, 24 functions) | `ev_7e658ad6adbe7b30…` |
| `native_strings_find jre/bin/java "Visibility"` (control, 0 matches) | `ev_55c0029797761ffc…` |
| `native_function_pseudocode jre/bin/java 0x8c0` (control, 7 lines) | `ev_e2135a87733100…` |
| `core_target_open bin/Visual_Paradigm` | `t_8bad3bce780a` (kind `unknown`) |
| `core_target_open jre/bin/java` | `t_e94ab2b5afc1` (kind `elf`) |

The refusals are errors, not evidence records: they carry the reason, not a
finding. That is why §16a quotes them verbatim instead of citing an id.

## 17. The sixth pass — the native tools were not reachable, and one candidate falsified

This pass was asked to re-run the native route: `core_target_open` on the main
program, `native_strings_find` for names, settings and messages, then
`native_function_pseudocode` on each function found. It could not be run, for a
reason that is not a refusal but an absence: the three tools are not part of this
session's tool surface at all — `tool_describe` on each name answers
`not_found`. Nothing here contradicts §0 or §16a; the refusals recorded there
(`Unknown file magic` on the launcher, `A Java program is not native machine
code` on the jars) still stand, and §16d already carries the control that proves
the tooling itself works: on `jre/bin/java`, a real ELF, the same three tools
answered normally (24 functions, 0 matches, 7 pseudocode lines).

So the sixth pass did what the Java target allows, and found one more value in
code — then had to falsify its own reading of it.

### 17a. A new value in code: a lifeline is pinned to y = 40

`vpplatform.jar!v/cck/v#a(Lv/cch/d;Lv/cci/a;)V` — the `InstanceSpecification`
shape adapter — runs after its `super.a(…)`:

| Step | Bytecode | Meaning |
|---|---|---|
| 1 | `invokevirtual j:()Lv/cmo/gj;` + `instanceof v/cnk/abb` | the shape is an `InteractionLifeLine` |
| 2 | `v/cci/a#i:()Lv/cmo/ii;` + `instanceof v/cmo/lm` | its model element is an `InstanceSpecification` |
| 3 | `v/cmo/gj#P:()I` vs `bipush 40`, `if_icmpeq` | if the current value is already 40, do nothing |
| 4 | `v/cmo/gj#o:(I)V` with `bipush 40` | otherwise set it to 40 |

Resolving what `P()` / `o(I)` mean — both are declared in `v/cmo/af`
(lib01.jar), not in `v/cmo/gj`:

| Getter / setter | Field | Saved as |
|---|---|---|
| `N()` / `b(v.cia.bts)` | `cf` | a model-element reference |
| `O()` / `n(int)` | `cg` | `"x"` |
| `P()` / `o(int)` | `ch` | `"y"` |
| `Q()` / `p(int)` | `ci` | `"width"` |
| `R()` / `q(int)` | `cj` | `"height"` |

`v/cmo/af#r_saveSetProperty` writes `this.cg` under `"x"`, `this.ch` under
`"y"`, `this.ci` under `"width"` and `this.cj` under `"height"`; the loader at
`af#b(…)` reads the same four keys back through `n/o/p/q`.

**So the constant is `setY(40)`: a freshly created `InteractionLifeLine` is
placed 40 px from the top of the sheet.** It is a position, not a size.

### 17b. The hypothesis this killed

`40` is also the number `mechanics.json` carries for `lifeline head height`, and
reading `P()`/`o(int)` as height/setHeight would have "confirmed" the decision
from code. That reading is wrong: `o(int)` is `setY`, and the pair that really
is height is `q(int)`/`R()` (`"height"`). The coincidence of the number is not
evidence, and the value stays what it always was:

| Value | Status after this pass |
|---|---|
| `lifeline head height` = 40 | **superseded by §23**: 35, from the insert box in `v/qi/o#e+0x00bf` |
| `actor lifeline head height` = 70 | **superseded by §23**: 48, the record's drawn head |
| `visibility icon protected / package colour` | still **placeholders** — state 0 (`VS_ICON`) only, which no record in the samples selects (§16c) |

Recorded here so the next pass does not re-run the 40 → height hypothesis: the
number matches, the method does not.

## 18. The connector's own shape — bends, corners, head direction (round 7)

Round 7 gave a link two new things: `waypoints: [[x,y], …]` (bends a person
places by hand) and `rounded: 'off'|'small'|'large'`. This section records
what of that is **the program's** and what is a decision, so the next pass
does not have to guess which numbers have an address behind them.

### 18a. The native pass, run again on the main program

The same three calls as §16a, repeated this round, answered identically:

| Call | Answer |
|---|---|
| `core_target_open` on `~/Visual_Paradigm_CE_17.3/bin/Visual_Paradigm` | `kind: "unknown"`, 17 166 B, sha256 `8bad3bce780a06a863e1c8d579f23199fb2da5d39d820803950cb861a95ed882` |
| `native_strings_find <launcher> --pattern AlignToGrid` | `not_supported: Couldn't read this as a program: the file is malformed (Unknown file magic)` |
| `native_functions_list <launcher>` | same refusal |
| `native_function_pseudocode <launcher>` | same refusal |
| control: `core_target_open` on `jre/bin/java` | `kind: "elf"`, 12 768 B, sha256 `e94ab2b5afc1e372…` |
| control: `native_functions_list jre/bin/java` | 24 functions, `coverage.examined: 24 / 24`, `engine: builtin 0.3.0` |

So the tools work; the file the person launches has no machine code to
disassemble. Everything below is `java_method_show` / `java_class_show` /
`java_class_users_find` on the jars — the same Deep-mode path as §13–§15.

Names do not lead to the router, and that is worth writing down: the classes
are obfuscated, and `java_classes_find` with `query: "route"` and with
`query: "rrect"` returned **0 of 35 230** classes in `vpplatform.jar`. A
connector feature is found by following *references*, not by searching names
for the English word.

### 18b. Bends are in the original's own records — `_points`

§5d already lists `_points` among a connector's stored values, described there
as **relative bends**. That is the mechanism `waypoints` reproduces: the
original keeps a bend list per connector and does not re-derive the route from
the two ends alone. Difference this build chose: the points are stored in
**sheet** coordinates and only when non-empty, so a file without bends is
written exactly as before (asserted by `tests/types.mjs`, round-trip of
`old-v3.json`).

### 18c. A corner in the original is a stroke join, not an arc

`vpplatform.jar!v/dal/au#a([F)Ljava/awt/BasicStroke;` (§13e) builds every line
as

    new BasicStroke(1.0f, 0 /* CAP_BUTT */, 1 /* JOIN_ROUND */, 0.0f, dash, 0.0f)

The join hint is `ROUND`, but a join is not a fillet: the only rounding a bend
gets for free is half the stroke weight — **0.5 px** at weight 1.0. That is
why `rounded: 'off'` (a plain `L` corner) is what the original actually draws,
and why the two rounded settings are additions rather than a copy of a
default. `lineCap` = `butt` from the same constructor is already carried into
`--line-cap` (`MECHANICS.lineCap`).

### 18d. The one place the jar does draw arcs — and why it is not the corner rule

`java_class_users_find --class-name java/awt/geom/Arc2D` on `lib01.jar`:
**14 references, 8 callers** (`coverage: partial`, 12 of 14 listed). The
drawing helper among them is `v/cda/e` — 7 fields, 28 methods. Its
`a(CLjava/awt/geom/Point2D;Ljava/awt/geom/Point2D;Ljava/awt/geom/Point2D;DDD)V`
is **185 instructions** and switches on its `char` argument:

| Style code | What it draws (from the pseudo-Java) |
|---|---|
| `1` | `Arc2D.Double(x − r, y − r, r, r, start, 180, 0)` appended to the path — a **half-circle end** of radius `r` (5th `double`) |
| `2` | `moveTo(x, y)` — a plain start |
| `3` | two runs offset by `(sin θ·r, cos θ·r)` with `θ = ((start + 180)/180)·π` — the **double-line** style |
| other | `lineTo` — a plain segment |

Its `a(DDDD)V` (25 instructions) is only `moveTo(x1,y1); lineTo(x2,y2)` (plus
the same two calls on the attached `Graphics` path when there is one) — a
segment, no curve.

So the arcs in this jar are round **ends** of a line of width `2r`, not corner
fillets. The build's corner arc is therefore its own: `geometry.js#pathD` cuts
each inner vertex back by `t = r·tan(θ/2)` and joins it with `A r r` **only
while the arc is really tangent** (`t ≤ r`, i.e. turns up to a right angle) and
`t ≤ min(ul, vl)/2`; a sharper fold or a corner between two short legs gets
`Q` with the vertex as control point, which cannot bow the line back on
itself. Exported SVG and the sheet call the same `pathD`, so the file cannot
disagree with the screen.

### 18e. Decisions of round 7 (no key, and no formula, in the original)

| Decision | Why | Where |
|---|---|---|
| corner radius `small` = **6**, `large` = **16** — **superseded in §27d** | round 7 found no fillet radius and the owner named these; the seventeenth pass found the real rule inside `v/cct/es#a(D)`: one cut of 7 px, a cubic through the corner, and no second size. §18c–d stay true (a stroke join is not a fillet, and the arcs in the jar are line ends) — what was missing was the *curve* the painter lays at a corner | `geometry.js#ROUND_R` → now both 7 |
| a bend handle is a **6×6** square (`x−3, y−3, 6, 6`), class `conn-wp`, accent colour | the owner named the size; colour is the existing accent token, so no new colour enters the sheet | `canvas.js#renderOverlay` (handle rect), `styles.css` `.conn-wp` |
| the label sits at **half the route's length**, not on the longest horizontal run | on a three-leg route the old rule put the name in the corner and on a U-turn on the way out; §12f is updated to match | `geometry.js#labelPos` |
| a head is aimed along the **last** segment, and its tangent at a rounded corner | §13b–c: every painter is handed only the tip point and `(length, width)` — the caller rotates the `Graphics2D` so `+y` runs back along the line. Direction is the caller's job, so the caller is where the last-segment rule belongs | `render.js#renderHead`, `geometry.js#pathD` |
| `rounded` and `waypoints` are written only when they differ from the default | keeps a pre-round-7 file byte-identical (§18b) | `io/umljson.js#canonicalWaypoints`, `tests/types.mjs` |

## 19. The native pass asked for again (round 8) — the same refusal, and one negative that holds

A later turn asked for the native route once more, in these words: open
`bin/Visual_Paradigm` with `core_target_open`, find the functions behind the
build with `native_strings_find` (names, settings, messages), follow the
references, and read each with `native_function_pseudocode`. It was run again
through the installed server (`craft-anything-cli --project
investigation.cany --deep …`), and it answered exactly as in §16a and §18a.

§17 recorded that the three names were absent from the session's tool surface.
That is still true of the MCP list (`tool_describe` → `not_found` for all
four); the CLI does reach them, and the table below is what they say.

| Call | Answer |
|---|---|
| `core_target_open bin/Visual_Paradigm` | `kind: "unknown"`, 17 166 B, sha256 `8bad3bce780a06a8…` → `t_8bad3bce780a` |
| `native_strings_find … --pattern AlignToGrid` | `not_supported: Couldn't read this as a program: the file is malformed (Unknown file magic)` |
| `native_functions_list …` | the same `not_supported`, the same message |
| `native_function_pseudocode … --function 0x1000` | the same `not_supported`, the same message |
| `native_strings_find lib/vpplatform.jar --pattern Visibility` | `not_supported: A Java program is not native machine code.` |
| **control** `native_functions_list jre/bin/java` | ran: **24 of 24** functions, engine `builtin 0.3.0`, `ev_771afeed1b23…` |

Three passes, three identical answers, one control that proves the toolset
itself works. The launcher is a shell script and the program is bytecode, so
there is no address space to lift and no native address to put in this sheet;
every address here stays `jar!class#method + bytecode offset`.

### 19a. What the Java path answered instead — one negative, and it is useful

`openapi.jar!com/vp/plugin/diagram/shape/IInteractionLifeLineUIModel` (Java 6,
1 field, 3 methods, `ev_72c53aedcc88…`):

| Member | Value |
|---|---|
| field `PROPERTY_SHOW_CLASSIFIER` | `"showClassifier"` |
| `isShowClassifier()` / `setShowClassifier(boolean)` | the only property pair on the shape |
| `isSupportDisplayImage()` | capability flag |

No head box, no height, no width — the lifeline's 40 px head and the actor
lifeline's 70 px (§12c) are **not properties of the shape**, so nothing a
person can set in the original produces them. They stay `estimated: true`;
what changed is that one class of source is ruled out by an address instead of
by a guess. The adapter that does handle `v.cnk.abb` —
`vpplatform.jar!v/bvf/r#a(Lv/cmo/gj;)V`, 513 instructions, `+0x0270` is the
`instanceof`, `ev_730f7df50ffb…` — only walks the lifeline's nested elements
and sets no size.

### 19b. What this pass changed in the build

Nothing. Every number in §7 already travels from `mechanics.json` through
`build.mjs#SHEET_KEYS` into `src/mechanics.generated.js`; this pass produced no
new value, and writing one without an address behind it is the exact failure
this sheet exists to prevent. The build was re-run after the pass and is green:
`dist/` rebuilt (13 positions, index.html 9 329 B, 428 stereotypes), and the
suite holds — 222 `types`, 29 `smoke`, 101 `rules`, 22 `shape-types`, 0 of 17
`gaps`, `inspect` reports no errors.

## 20. Round 9 — the pass on the main program, and the empty-compartment switch

The pass asked for again: open `bin/Visual_Paradigm` with `core_target_open`,
find the functions behind the build with `native_strings_find` (names, settings,
messages), follow the references, read each with `native_function_pseudocode`.
Run again this round, through the installed server
(`craft-anything-cli --project investigation.cany --deep …`).

### 20a. The calls and their answers

| Call | Target | Answer |
|---|---|---|
| `core_target_open` | `bin/Visual_Paradigm` | `kind: "unknown"`, 17 166 B, sha256 `8bad3bce780a06a8…` → `t_8bad3bce780a` |
| `native_strings_find --pattern "Show empty compartments"` | the same launcher | `not_supported`: *Couldn't read this as a program: the file is malformed (Unknown file magic)* |
| `native_function_pseudocode --function 0x1000` | the same launcher | the same `not_supported`, the same message |
| `native_strings_find --pattern "showEmptyCompartments"` | `lib/lib01.jar` | `not_supported`: *A Java program is not native machine code.* |
| **control** `native_strings_find --pattern "Compartment"` | `jre/bin/java` (ELF, same folder) | ran: `0 matches`, `ev_6a15638e6e694fcc…` |

Fourth round, fourth identical answer; the control still proves the toolset
works. The names, settings and messages of this program are not in a data
section — they are UTF-8 entries in the constant pool of 63 292 `.class` files
in `lib01.jar` (35 230 in `vpplatform.jar`). So the string pass was done on the
constant pools themselves, and every hit was then read with `java_method_show`
through the addresses below.

### 20b. What the strings found

| String (verbatim from a constant pool) | Class it lives in | What it is |
|---|---|---|
| `Show empty compartments` | `lib01.jar!v/acq/ac+0x045c` | the checkbox in the options dialog; its label goes through the word table |
| `Class.showEmptyCompartments` | `lib01.jar!v/cni/a#z+0x0c11` | the **default** of the property: `lconst_0` |
| `Class.showEmptyCompartments.0/.1/.2` | `lib01.jar!v/cni/b#b+0x1fd5/+0x1fe2/+0x1fef` | the three **labels**: `Follow Diagram`, `Yes`, `No` |
| `ClassDiagram.showClassEmptyCompartments.1/.2` | `lib01.jar!v/cni/d#b+0x20b3/+0x20bd` | the diagram's own two labels: `Yes`, `No` |
| `ProjectDiagramOptions_ShowClassEmptyCompartments` | `lib01.jar!v/cjn/ab+0x0292` | the project-wide option (written as a boolean, read with `b(…,false)`) |
| `showEmptyCompartments` | `lib01.jar!v/cnk/er#M(I)+0x0012` | the notification string the setter fires |
| `Show empty compartments` | `UserLanguage/Russian.lng`, section `Option Dialog` | `Показать пустые отделения` |
| `absoluteLifelineSpacingDistance` / `messageSpacing` | `vpplatform.jar!v/cmo/ln`, `lib01.jar!v/cmo/lm` | the interaction layout options and their change listener |

### 20c. The three codes — `v/cni/a`, `v/cni/b`, `v/cnk/er#M(I)`

`v/cnk/er#M(I)V` (the class model element's setter) is 12 instructions and says
everything about where the value lives:

    iload_1; getfield gH:I; if_icmpeq 27      // unchanged → nothing happens
    putfield gH:I                             // the value itself
    invokevirtual ak()                        // mark the diagram dirty
    ldc "showEmptyCompartments"; p(String)    // fire the change
    invokevirtual as()                        // notify

Its constructors write `iconst_0; putfield gH:I` — **0 is the state of a class
that never set the property**, and `v/cni/b` names 0 `Follow Diagram`,
1 `Yes`, 2 `No`. `v/cni/d#b` gives the diagram key the same two names for 1 and
2, without a "follow" — a diagram cannot follow itself.

| Value | Meaning | Address |
|---|---|---|
| `0` | **Follow Diagram** (default of the property) | `v/cni/a#z+0x0c11` (`lconst_0`), label `v/cni/b#b+0x1fd5`, field init `v/cnk/er#<init>` |
| `1` | **Yes** — an empty attribute/operation compartment is drawn | label `v/cni/b#b+0x1fe2` → `"Yes"`; diagram `v/cni/d#b+0x20b3` |
| `2` | **No** — nothing is drawn for an empty compartment | label `v/cni/b#b+0x1fef` → `"No"`; diagram `v/cni/d#b+0x20bd` |

### 20d. The correction this forced

The sheet used to carry a row `show empty compartments = 2` sourced from
`resources/BaggageSchemas.vpp` and nothing in the build read it. Read against
the tables, that `2` is not a count of compartments — it is the word **«No»**.
The shipped sample therefore hides empty compartments, and the build, which
skipped empty bands unconditionally (`if (!shown) continue`), was right for the
sample by luck and wrong for every class that says otherwise.

Now the value is a property of the **class** (as in the original: the shape's
`v/bet/gg#setShowEmptyCompartments(I)V` writes through to `v/cnk/er#M(I)V`),
and the band it controls is one text line tall:

| State | What the sheet shows |
|---|---|
| absent / `0` | the diagram's state; a fresh diagram is **Yes** (`EC_DEFAULT`), so a class with no members has its attribute and operation bands |
| `1` | bands drawn even when empty |
| `2` | only the name compartment; no separator, no band height |

An empty band is **one text line** tall — 21 px as this pass measured it
(`LINE_H + 2·PAD_Y`); §32d then read the program's own formula and made it
`rows × 14 + 2` = 16 px. That height is a **decision**:
no record stores a per-compartment height, the class shape exposes no such
property, and nothing in the jar names one. The build does not stretch
compartments to fill the shape either; it never did, and a stretch would be a
layout rule with no address behind it.

The one number that is **not** in the original is the diagram's default. The
diagram key is a checkbox that stores only 1/2, and its registry has no default
for it, so the build takes `1` («Yes») as the state of a fresh diagram and says
so in `mechanics.json` (`decision`). The sample's `2` is kept as a separate row
(`sample class diagram empty compartments`) so the record and the rule do not
share one name again.

### 20e. A second number this pass confirmed

`vpplatform.jar!v/dal/ak#<init>` (27 instructions) writes `p=0`, `q=0`,
`r=80`, `s=30`; `a()` returns `r`, `b()` returns `s`, `c()`/`d()` return `p`/`q`.
The reader in `v/dap/r` fills exactly those: `AbsoluteLifelineSpacingDistance →
ak.a(I)` (`+0x4180`) and `AbsoluteMessageSpacingDistance → ak.b(I)` (`+0x4190`),
and `v/cmo/lm#<init>` copies `v/dap/r#av()` into a fresh diagram's layout
options. So **80 and 30 are the code defaults**, not only the values in the
person's file, and the per-diagram `lifelineSpacing` / `messageSpacing` are `0`
= "automatic". §12b's numbers stay as they were; what changes is that they now
have an address in code as well as in the record.

### 20f. What changed in the build

| Where | Change |
|---|---|
| `mechanics.json` | four rows replace the old `show empty compartments`: `follow diagram` 0, `yes` 1, `no` 2, `diagram default` 1 (decision); the record's `2` keeps its own row |
| `build.mjs` | `SHEET_KEYS` → `emptyCompartmentsFollow/Yes/No/Default` |
| `src/model/geometry.js` | `EC_FOLLOW/EC_YES/EC_NO/EC_DEFAULT`, `emptyCompartmentsShown()`, and `layoutOf` pushes a one-line blank band for an empty `members` compartment while the switch is on |
| `src/io/umljson.js` | `emptyCompartments` is written only as 1 or 2 (0 is the default and stays absent, so an old file re-saves byte for byte); the reader drops anything else |
| `src/ui/panels.js` | «Пустые отделения» — `Как на диаграмме / Да / Нет` on every class with member compartments |
| `tests/types.mjs` | six checks: two bands by default, none at 2, both at 1, the value in the file, byte-identical round trip, and 0 never written |

### 20g. Evidence

| Call | Evidence id |
|---|---|
| `java_method_show v/cni/b#b` (5001 instructions, labels at `+0x1fd5…+0x1ff2`) | `ev_fc6fd817ae41f0ae…` |
| `java_method_show v/cni/a#z` (2358, default at `+0x0c11`) | `ev_77f9a7d90cc25557…` |
| `java_method_show v/cni/d#b` (4086, diagram labels at `+0x20b3…+0x20c0`) | `ev_326898b3bcff8e0e…` |
| `java_method_show v/bet/gg#setShowEmptyCompartments` (21) | `ev_3ba43d238f6f48f5…` |
| `java_method_show v/dal/ak#<init>` (27) | `ev_564506ba87e7ab05…` |
| `java_classes_find openapi.jar "Compartment"` (6 of 2204) | `ev_34ab828152890424…` |
| `native_strings_find jre/bin/java "Compartment"` (control) | `ev_6a15638e6e694fcc…` |
| `core_target_open bin/Visual_Paradigm` | `t_8bad3bce780a` (kind `unknown`) |

## 21. Round 10 — the pass on the main program, and the numbers the import was missing

The iteration added PlantUML **import** (§7 of the plan; the export was already
checked against the jar). The import seeds a sheet, and the seed carried numbers
that had no address: `ACTIVITY_STEP 120` / `STATE_STEP 140` were described as
"plan §7.2", `LANE_W 200`, `MARGIN 40`, `PAD 20`, `ROW_H 15`, the 720×440 sheet
and the 1400 wrap were plain literals, and the sequence pitches 80 / 30 were
sourced only from a record. This section is the pass that was asked for: open the
main program, search its strings and settings, follow the references, read the
functions — and then either wire the real value or say in writing that the
original has none.

### 21a. The calls and their answers

| Call | Target | Answer |
|---|---|---|
| `core_target_open` | `~/Visual_Paradigm_CE_17.3/bin/Visual_Paradigm` | `kind: "unknown"`, 17 166 B, sha256 `8bad3bce780a06a863e1c8d579f23199fb2da5d39d820803950cb861a95ed882` → target `t_8bad3bce780a` |
| `native_strings_find --pattern "class"` | the same launcher | `not_supported`: *Couldn't read this as a program: the file is malformed (Unknown file magic)* |
| `native_function_pseudocode` | the same launcher | `… 0x1000` reads `0x1000` as a **path** → `not_found: …/0x1000: No such file or directory`; aimed at the jar with no `--function` → `bad_input: invalid params: missing field 'function'`. Neither form ever reaches a function: there is no `not_supported` for it because the target is refused before that |
| `core_target_open` | `lib/vpplatform.jar` | `kind: "jar"`, 87 531 369 B, sha256 `21cb389907020c7f445e522db0903498054caf0a340425eafbbfa43e0b439f36` |
| `native_strings_find --pattern "message spacing"` | `lib/vpplatform.jar` | `not_supported`: *A Java program is not native machine code.* |
| `native_function_pseudocode` | `lib/vpplatform.jar` | `bad_input`: missing field `function` — the argument check fires before the format check, so the jar never gets as far as `not_supported` here |
| **control** `native_strings_find --pattern "MessageSpacing"` | `jre/bin/java` (ELF, same folder) | ran: `0` matches, `status: complete` — `ev_1542ca87a29f50dc05006d51a23deee70ad86b73528221a5589a9be797567550f` |

So the native toolset works and the target is not machine code. The names,
settings and messages of this program are UTF-8 entries in the constant pools of
35 230 `vpplatform.jar` classes and 63 292 `lib01.jar` classes. The string pass
was therefore run over the pools — every class file's `CONSTANT_Utf8` table was
extracted and searched for the words of this build (`Spacing`, `DefaultSize`,
`Layout`, `Swimlane`, `Lifeline`, `Message`) — and every hit was then read back
through `java_class_show`, `java_method_show` and `java_class_users_find`.

### 21b. The sequence pitches, now from code

`vpplatform.jar!v/dal/ak` is the interaction-layout options block. Its
constructor, 27 instructions, is the whole table:

| Offset | Instruction | Field | Key it fires | Value |
|---|---|---|---|---|
| `v/dal/ak#<init>+0x0005` | `iconst_0; putfield m` | `m` | `handleLabelsWhenLayout` | `false` |
| `v/dal/ak#<init>+0x000a` | `iconst_1; putfield n` | `n` | `realTimeLayout` | `true` |
| `v/dal/ak#<init>+0x001b` | `iconst_0; putfield p` | `p` | `lifelineSpacing` | **0** (auto) |
| `v/dal/ak#<init>+0x0020` | `iconst_0; putfield q` | `q` | `messageSpacing` | **0** (auto) |
| `v/dal/ak#<init>+0x0025` | `bipush 80; putfield r` | `r` | `absoluteLifelineSpacingDistance` | **80** |
| `v/dal/ak#<init>+0x002b` | `bipush 30; putfield s` | `s` | `absoluteMessageSpacingDistance` | **30** |

The field → key mapping is not guessed: each setter writes one field and then
fires a change named by a constant. `v/dal/ak#a(I)V` writes `r` at `+0x000f` and
`ldc "absoluteLifelineSpacingDistance"` at `+0x0016`; `v/dal/ak#b(I)V` writes
`s` at `+0x000f` and fires `"absoluteMessageSpacingDistance"`; `c(I)V` writes `p`
(`"lifelineSpacing"`), `d(I)V` writes `q` (`"messageSpacing"`). Getters
`a()/b()/c()/d()` return `r/s/p/q` in that order.

The consequence is the rule the build needed: **the relative distances are 0, so
the absolute ones are what gets drawn** — 80 px between lifelines, 30 px between
messages. The record in `myProject.vpp`
(`_interactionDiagramLayoutOptions @absoluteLifelineSpacingDistance=80,
@absoluteMessageSpacingDistance=30`) is the same pair, which is why the record and
the code agree instead of contradicting each other. Evidence:
`ev_876b6aa0273c7370381c8dd2671bd46b73ed830d0572e114d47fcc83c47a2418`
(`v.dal.ak.<init>`).

### 21c. What the original does *not* have: a fixed pitch

The seed can only place shapes in a deterministic order, so it needs a step. The
original has none, and this pass can show it three ways:

1. **Its own sample has no constant pitch.** In `resources/BaggageSchemas.vpp`,
   `DIAGRAM_TYPE='ActivityDiagram'`, the placed nodes stand at
   `y = 53, 171, 269, 382` — gaps of 118, 98, 113 px. The 40–50 px nodes were put
   there by a person dragging them, one at a time.
2. **Its positions are stored, not computed.** Every shape in that diagram
   carries its own `x` and `y` in `DIAGRAM_ELEMENT.DEFINITION` (`x=531; y=53;`
   for the first `ActivityAction`), and nothing in the file derives them.
3. **The only spacing it owns belongs to Auto Layout**, and that is the feature
   the owner refuses («проблема планта — там автораскладка»). The block is
   `vpplatform.jar!v/dap/o`, five fields, built in its constructor:

   | Offset | Instruction | Field | Key | Value |
   |---|---|---|---|---|
   | `v/dap/o#<init>+0x0006` | `iconst_1` | `k` | `AspectRatioOfView` | `true` |
   | `v/dap/o#<init>+0x000b` | `bipush 20` | `l` | `BendDistance` | `20` |
   | `v/dap/o#<init>+0x0011` | `bipush 10` | `m` | `HorizontalSpacing` | `10` |
   | `v/dap/o#<init>+0x0017` | `ldc 1.41f` | `n` | `PreferredAspectRatio` | `1.41` |
   | `v/dap/o#<init>+0x001d` | `bipush 10` | `o` | `VerticalSpacing` | `10` |

   It is instantiated by the layout settings model
   `vpplatform.jar!v/daj/ac#<init>+0x0501` (`new v.dap.o; invokespecial <init>`)
   and restored/saved through `v/daj/ac#bD()` → `v/dap/o#b(Lv/dvk/i)V`. The
   layout engine behind it is yFiles: the `y.layout.*` key strings live in
   `vpplatform.jar!v/dwy/*`, `v/dxa/*`, `v/dxb/*`, `v/dxd/*` and `v/dxq/*`
   (`y.layout.Layouter.NODE_ID_DPKEY`, `y.layout.hierarchic.Drawer.NODE_DISTANCE`,
   `y.layout.tree.ARTreeLayouter.PLACEMENT_TOP`), which is *why* these are Auto
   Layout options and not a grid.

Evidence: `ev_b3c3cffda7e432501918ed082661f275571e294b61c7d7bee8d38f4bcb8ba558`
(`v.dap.o`), `ev_9ca5e2d03927a87678abf170aa40f91ac2d769b94500ef50a037bf0fb3092071`
(75 references from 22 methods — all of them the layout settings model, none of
them shape creation).

**Therefore the seed's pitches are decisions, and the sheet now says so.** That
is not a softer claim than before; it is the true one. `app/mechanics.json`
carries them with `decision:` and the reason, and `plantuml-layout.js` reads them
from the sheet instead of holding literals:

| Sheet row | Value | Why it is a decision |
|---|---:|---|
| `seed sibling gap` | 40 | four grid cells (grid 10 is code); the original places nothing, so no gap exists to copy |
| `seed frame inset` | 20 | two grid cells — the inset of a package around its children |
| `seed activity step` | 120 | a column of activity nodes; the sample's own rows are 118/98/113, i.e. no constant (21c.1) |
| `seed state step` | 140 | same reasoning for a state chain |
| `seed lane width` | 200 | one swimlane column, equal to the swimlane shape the nodes stand in (200×300 in the notation) |
| `seed sheet width` / `height` | 720 / 440 | the smallest sheet the seed will draw |
| `seed wrap width` | 1400 | a page limit: a row of shapes breaks before it |
| `member row height` | 15 → **14** | **moved to code in §32d**: the row is `FontMetrics.getHeight()` (14 for Arial 11) and the compartment adds 2, not `2 × PAD_Y` — `v/due/f#a(…)+0x0336/+0x0342`. It was a decision when this table was written |

### 21d. What the build now does with it

`app/build.mjs` grew ten `SHEET_KEYS` entries, so each of these numerals can only
enter the site through the sheet:

```
'member row height'      → memberRowHeight      (14, §32d)
'member compartment padding' → memberBlockPadding (2, §32d)
'seed sibling gap'       → seedSiblingGap       (40)
'seed frame inset'       → seedFrameInset       (20)
'seed activity step'     → seedActivityStep     (120)
'seed state step'        → seedStateStep        (140)
'seed lane width'        → seedLaneWidth        (200)
'seed sheet width'       → seedSheetWidth       (720)
'seed sheet height'      → seedSheetHeight      (440)
'seed wrap width'        → seedWrapWidth        (1400)
```

`app/src/io/plantuml-layout.js` no longer writes a sheet number as a literal:
every one of them is `MECHANICS.<key>`, with the kind (`code` / `record` /
`decision`) written next to it. (The size table `DEFAULT_SIZE` stays literal on
purpose — it is the `notation/uml.json` copy this module needs under Node, and
F4 checks the two agree.) Three literals that survived inline were also
folded into named values so they cannot drift: the state column's 40 px offset,
the `Math.max(h, 40)` floor, and the 260 px minimum lifeline depth
(`LIFELINE_W * 2 + PAD`). `app/src/model/geometry.js` now takes `LINE_H` from
the same `member row height` row, so a member row and a compartment band can no
longer disagree.

Two rows changed source rather than value: `message spacing` (30) and
`lifeline spacing` (80) now cite `v/dal/ak#<init>+0x002b/+0x0025` and keep the
record as a second witness.

Result:

```
$ cd app && node build.mjs
build готов: dist/ — копия сайта (14 позиций, index.html 9485 Б, стереотипов 304 из 428 записей VP)
$ node tests/plantuml-import.mjs
23 ok, 0 skip, 1 fail · круг: строго 26/48, объяснено 18, пропущено 1, непонятно 3
```

The one failure is **B1** and it is not from this pass: the same suite run against
a copy of the app with the literals put back (`40/20/15/120/140/200/720/440/1400`,
LINE_H 15) prints the identical line `26 ok… 3 непонятно`. The three unexplained
round-trip models are the `<<stereotype>>` on a lifeline and the `<-->` form —
the two gaps `docs/user-guide/import-plantuml.md §4` already names as import-side holes, plus
`abstract actor`. They are parser work, not layout work, and are left for the next
iteration rather than hidden by loosening B1.

### 21e. Found, read, and deliberately not wired

These six are **not rows of `mechanics.json`**: the sheet is the list of numbers
the build uses, and `rebuild_check` holds it to that (a row nothing reads is a
false green). They are recorded here instead, with their addresses, because a
later iteration will want them the moment it touches Auto Layout or connectors.

| Value | Address | Why the build does not use it |
|---|---|---|
| `HorizontalSpacing` 10 | `v/dap/o#<init>+0x0011` | it is an Auto Layout input; the import must not lay out |
| `VerticalSpacing` 10 | `v/dap/o#<init>+0x001d` | same |
| `BendDistance` 20 | `v/dap/o#<init>+0x000b` | same — it bends connectors during Auto Layout |
| `PreferredAspectRatio` 1.41 | `v/dap/o#<init>+0x0017` | same |
| `relative lifeline/message spacing` 0 | `v/dal/ak#<init>+0x001b/+0x0020` | it means "auto"; the drawn numbers are the absolute 80/30 the build already reads |
| sample activity sizes (`ActivityAction` 60×40, `StructuredActivityNode` 120×50, `InteractionLifeLine` 70×150) | `resources/BaggageSchemas.vpp`, `DIAGRAM_ELEMENT.DEFINITION` | they are one hand-drawn diagram, not a default; shape sizes keep coming from `notation/uml.json#defaultSize` (checked by `tests/types.mjs` F4) |

## 22. Э8 — the last four estimates, and why they stay estimates

The sheet had four rows with `estimated: true` left: the two visibility-icon
colours and the two lifeline head heights. This pass went after all four with
the Java route (§16a — the native route is dead, `core_target_open` answers
`unknown`), and the honest outcome is **four negatives with addresses**. None of
the four numbers was found in the program; none of the four marks was lifted.

The method, because it is repeatable and cheaper than decompiling: parse the
constant pool of every `.class` inside every jar (19 files, 63 292 + 35 230 +
2 204 classes in the three big ones) and look for the literal as a `CONSTANT_Utf8`
and as a `CONSTANT_Integer`; then `javap -p -c` only the handful of classes that
survive, to see what they do with the number.

### 22a. The two icon colours: the numbers are not the program's

| Where the search went | Result |
|---|---|
| constant pools of all 19 jars: `"9a6700"`, `"#9a6700"`, `Integer 10118400` (`0x9a6700`), `"1f5fa9"`, `"#1f5fa9"`, `Integer 2056105` (`0x1f5fa9`) | **0 hits** |
| byte grep of the whole installation (`resources/`, `shapes/`, `bundled/`, `ormlib/`, excluding only `jre/`) | **0 hits** |
| any jar entry or file name containing `visib` | only two Velocity templates for code generation (`resources/instantgenerator/{csharp,vbnet}/visibility.vm`) — no icon, no colour table |
| `IClassUIModel` (both `openapi.jar` and `lib02.jar`) | `VISIBILITY_STYLES` holds the three **names** (`Icon`, `UML`, `Off`); there is no parallel colour array |
| the write path of the style | `lib01.jar!v/bet/gg#setVisibilityStyle(I)+0x0008` (jar corrected in §23e): `getfield c:Lv/cnk/vd; iload_1; invokevirtual v/cnk/vd.u:(I)V` → `v/cnk/er#u(I)+0x0009 putfield gi` + `ldc "visibilityStyle"` — an `int` goes into the graphic, nothing else |

So state 0 does not pick a hue per visibility kind: the glyph is painted in the
shape's own foreground, which the record fixes at `(0,0,0,255)` for every
lifeline and class in `myProject.vpp`. The two placeholder colours are this
build's invention — plausible, but invented, and §16c already says the build
never paints them (every record and the factory default store `1` = `VS_UML`).
Both rows keep `estimated: true`; their `source` now carries this table in one
sentence, so the next pass does not repeat the scan.

### 22b. The two head heights: no property, no constant, and one formula that is not a figure

Three independent checks, all negative:

1. **No such name exists.** A case-insensitive scan for `head` over every constant pool of every
   class turns up Word/XML boilerplate (`Heading1`, `Header`) and, of the
   size-bearing names, only `ForeignKeyArrowHeadSize`, `ColumnHeaderHeight`,
   `RowHeaderWidth` and the partition-header setters — nothing about a lifeline.
   `headHeight`, `getHeadHeight`, `HEAD_HEIGHT`, `LifelineHead`: zero hits. This
   matches §17: `IInteractionLifeLineUIModel` has one field (`showClassifier`)
   and three methods, and there is no property for a head.
2. **The renderer that owns the lifeline has no sizes.** `v/bvf/*` is the only
   package that references the lifeline's graphic element (`v/cnk/abb`), and the
   only class there that does (`vpplatform.jar!v/bvf/r`) sets positions, not
   sizes: its whole bytecode carries `bipush 7` and `bipush 6` and nothing else.
3. **The record has no head box either.** `myProject.vpp` is SQLite; a lifeline
   is one row of `DIAGRAM_ELEMENT` with 18 keys in `DEFINITION`. The only height
   anywhere on the head is `_captionUIModel @height`:

   | Value | How many of the 35 lifelines | What it is |
   |---|---|---|
   | 14 | 14 | one line of the name (the one actor carries the same 14) |
   | 26 | 17 | name + stereotype line |
   | 15 | 4 | the same one-line plate, stretched by hand |

   That is `12 px per line + 2`, i.e. the caption box, not a figure constant —
   and `name caption height` (14, group `notation`) already carries the same
   finding. Writing 14 here would be the same number twice under two names, and
   40 in the build is deliberately the height of a *two-line* plate.

One more coincidence had to be killed the way §17b killed the first: every
lifeline carries `parentConnectorHeaderLength=40` (29 of 35), the same 40 as
this row. It is the stub from the shape to its parent frame — `parentConnectorLineLength`
sits next to it — and not a head. The number matches; the key does not.

### 22c. The actor head: one record says 48, and one record is not a measurement

`myProject.vpp` has exactly one `InteractionActor` (the `XMLRPCServer` lifeline)
and it stores `width=60` plus `_captionUIModel @x=-20 @y=34 @width=99 @height=14`:
the figure occupies the 34 px above the caption, so that head is 34 + 14 = 48,
not 70. That is a single hand-placed shape, so it is a witness, not a default —
and the palette default the code does carry is a different figure altogether:
`vpplatform.jar!v/qi/o#a(v/cia/bts,String,boolean)+0x0035..0x0067` creates a new
actor node with `v/cnk/aay.a(IIII)` = `(x+100, y+40, 100, 35)` — a 100×35 box,
and this is the *communication* diagram's own insertion code. 70 stays a
decision; the source row now records 48 and the 100×35 so the next pass can
start from the numbers instead of the names.

### 22d. What this pass changed

| File | Change |
|---|---|
| `mechanics.json` | four `source` strings rewritten; **all four keep `estimated: true`**, no value moved |
| `MECHANICS.md` | this section; the `stereotype profile` row of §7 (428 → 304, `profile/stereotypes.json`); the visibility row of §8 got a pointer here |
| no `src/` file | not needed: the estimate did not become a measurement, so nothing reads differently |

The rule this pass obeyed is the one the sheet has obeyed from §0: a mark comes
off only when there is an address. `#9a6700`, `#1f5fa9`, `40` and `70` have
none, so the four marks stay — each with a list of the places that do not hold
the answer, which is the useful half of a negative.

**Superseded for two of the four by §23**: `v/qi/o` *does* size the head — 100×35
— and the actor head is the record's 48. The two icon colours stay rejected.

## 23. Round 13 — the pass on the main program, and the box the factory inserts

### 23a. The native tools, once more, with a control that works

| Step | Call | Result |
|---|---|---|
| open the main program | `core_target_open` on `bin/Visual_Paradigm` | `kind: "unknown"`, 17 166 B, sha256 `8bad3bce780a06a8…` — the same POSIX **shell** launcher as §0 and §16a |
| search its strings | `native_strings_find "visibility"` | `not_supported: Couldn't read this as a program: the file is malformed (Unknown file magic)` |
| read a function | `native_function_pseudocode --function 0x1000` | `not_supported`, verbatim the same message |
| **control** | `core_target_open` on `jre/bin/java`, then `native_strings_find "visibility"` | `kind: "elf"`, 12 768 B, sha256 `e94ab2b5afc1…`; search returned `total: 0`, `coverage.status: "complete"`, one limitation (`data_sections_only`) |

The refusal is therefore the file, not the toolset: the native engine declined a
shell script, and the same three calls worked on the only ELF in the folder. The
program the launcher starts is Java (`jre/bin/java -cp lib/*.jar`), and a `.class`
has no load address, so the code is read with `java_class_show` /
`java_method_show` and the address is `jar!class#method + bytecode offset`.
Every call above left a record in `investigation.cany/evidence/`.

### 23b. Where a sequence lifeline comes from — `lib01.jar!v/qi/o`

§22c named the wrong file for this class: `v/qi/o` is in **`lib01.jar`** (6 710 B),
not `vpplatform.jar`, and it is the **interaction** insertion factory — it holds
the literals `"InteractionLifeLine"`, `"InteractionActor"`, `"Activation"`, a
`v/qi/p` frame cursor (`a` = x, `b` = y, `c` = row) and an `ArrayList` of the
shapes it made. The relevant method is `e()` (411 bytes), and the four numbers
are one instruction run:

```
00ae: aload_2                     // the new v/cnk/abb
00af: aload_1                     // the frame cursor v/qi/p
00b0: invokestatic  v.qi.p.a(Lv/qi/p;)I     // frame's x
00b3: bipush 100
00b5: iadd
00b6: aload_1
00b7: getfield    v.qi.p.b:int               // frame's y
00ba: bipush 40
00bc: iadd
00bd: bipush 100                              // width
00bf: bipush 35                               // height
00c1: invokevirtual v.cnk.abb.a(IIII)V        // = v.cmo.gj#a(IIII)V
```

So a lifeline is created as a **100 × 35 box, 100 px right of the frame's x and
40 px below its y**. The argument order is not guessed: `v/cmo/gj#a(IIII)V`
forwards them one-for-one to `n/o/p/q` (`+0x0002`…`+0x000f`), and §17a already
read the save routine — `af#r_saveSetProperty` writes `cg` under `"x"`, `ch`
under `"y"`, `ci` under `"width"`, `cj` under `"height"`, which is exactly
`n`/`o`/`p`/`q`. `e()` proves the same pairing from the other side: the
activation it creates is placed at `O() + Q()/2 − 4` — `O()` reads `cg`, `Q()`
reads `ci` — i.e. centred on the head, with width 8.

The actor goes through the same numbers: `v/qi/o#a(v/cia/bts,String,Z)`,
`+0x0053`…`+0x0067`, calls `v/cnk/aay.a(p.a(frame)+100, frame.b+40, 100, 35)`,
then `g(1)` at `+0x006c` and `ak()` at `+0x0070`.

### 23c. The activation that comes with it

`v/qi/o#e()`, on the `v/cnk/na` it creates:

```
016a: aload_3 ; aload_2 ; invokevirtual v.cnk.abb.O()I ; aload_2 ; invokevirtual v.cnk.abb.Q()I
0173: iconst_2 ; idiv ; iadd ; iconst_4 ; isub
0178: invokevirtual v.cnk.na.n(I)V     // x = head.x + head.width/2 − 4
017b: aload_3 ; bipush 8 ; invokevirtual v.cnk.na.p(I)V        // width 8
0181: aload_3 ; aload_0 ; invokevirtual v.qi.o.c()I ; bipush 30 ; iadd
0189: invokevirtual v.cnk.na.o(I)V     // y = frame row cursor + 30
018c: aload_3 ; invokevirtual v.cnk.na.ak()V
```

Width 8 is the sheet's `activation width`; `+30` is the message pitch
(`absoluteMessageSpacingDistance`, §21b) — an activation starts one message row
below the head.

### 23d. What the record confirms, and what it cannot

| Record fact (`myProject.vpp`) | Reading |
|---|---|
| `y=40` on 21 of 35 `InteractionLifeLine` elements | the factory's `+40` — the placement is the program's, not a coincidence |
| `_captionUIModel @y=0 @height=14` (26 with a stereotype line) | the name plate sits at the **top** of the 35 px head, 12 px per line + 2 |
| widths 70, 80, 90, 100, 120 and `height=530` | hand resizes of the 100 × 35 insert box; a record width is not a default |
| one `InteractionActor`: `width=60`, caption `@y=34 @height=14` | figure 34 above the plate → drawn head 34 + 14 = **48**, the value the sheet now carries |

The record stores no head box, so it cannot contradict 35 — and code cannot give
the actor's drawn head, because the figure grows past the insert box. Each row
says which of the two it stands on.

### 23e. The visibility style is one int, not a palette

The two icon colours went from "placeholder" to **rejected** on a second look at
where the style lands. `v/bet/gg#setVisibilityStyle(I)` (lib01.jar; §16a read the
same call) is nine instructions:

```
0008: getfield  v.bet.gg.c:Lv/cnk/vd;
000b: iload_1
000c: invokevirtual v.cnk.vd.u(I)V
```

and `v/cnk/vd` inherits `u(int)` from `v/cnk/er`, where it is one field and a
property event:

```
0009: putfield v.cnk.er.gi:int
0012: ldc "visibilityStyle"
0014: invokevirtual v.cnk.er.p(Ljava/lang/String;)V
```

One int, one property name, nothing beside them — so a colour per visibility kind
has no place to live. Together with §22a's zero hits for `9a6700`/`1f5fa9` (and
for the two Integers) in every pool and resource, the rows cannot stand as
values: they are marked `rejected`, and the build paints `vis-*` with
`currentColor` (`src/ui/icons.js`), i.e. the shape's own foreground — the record's
`foreground=(0,0,0,255)`.

### 23f. What this pass changed

| File | Change |
|---|---|
| `mechanics.json` | `lifeline head height` **40 → 35** (code, `v/qi/o#e+0x00bf`); `actor lifeline head height` **70 → 48** (record); both lost `estimated`; the two icon colours became **rejected** with the address that shows no table exists. `estimated` count: **4 → 0** |
| `src/mechanics.generated.js` | rebuilt from the sheet by `build.mjs` — `lifelineHead: 35`, `actorLifelineHead: 48` |
| `src/model/geometry.js`, `src/ui/render.js`, `src/io/plantuml-layout.js` | no edit: they read `MECHANICS.lifelineHead` / `MECHANICS.actorLifelineHead`, so the drawn head and the imported seed follow the sheet |
| `dist/` | rebuilt (`node build.mjs`), `src` and `dist/src` identical; drawn heads measured in the running page: three heads 120×**35** at y=60, names at y=77.5 (the 14 px plate centred in 35) |

## 24. Round 14 — the two connector enums, read out of the program's own value table

### 24a. The calls and their answers

| Step | Call | Result |
|---|---|---|
| open the main program | `core_target_open` on `bin/Visual_Paradigm` | `kind: "unknown"`, 17 166 B, sha256 `8bad3bce780a…` — the same POSIX shell launcher as §0, §16a and §23a |
| search its strings | `native_strings_find "Spacing"` | `not_supported: Couldn't read this as a program: the file is malformed (Unknown file magic)` |
| read a function | `native_function_pseudocode --function 0x1000` | the same `not_supported`, verbatim: `Couldn't read this as a program: the file is malformed (Unknown file magic)` |
| **control** | `core_target_open` on `jre/bin/java`, then `native_strings_find "Spacing"` | `kind: "elf"`; search returns `total: 0`, `coverage.status: "complete"`, one limitation (`data_sections_only`) — `ev_9e016e0f0c0cb516…` |
| open the code | `core_target_open` on `lib/vpplatform.jar` | `kind: "jar"`, 87 531 369 B, sha256 `21cb38990702…` |
| search *inside* the jar | `native_strings_find "connectorStyle"` on that jar | `not_supported: A Java program is not native machine code` — the refusal is the format, not the pattern |

So §16a's conclusion holds on a fifth run: nothing in this install is machine
code except the bundled JRE. The bytes that answer the question are
**constant-pool strings**, and the functions that read them are Java.

### 24b. How the classes were found without names

Class names are obfuscated (`v/cni/b`), so the search went the other way: every
`.class` in `lib01.jar` and `vpplatform.jar` was walked, its constant pool parsed
(tag 1 = Utf8) and the printable entries shorter than 60 characters filtered for
`connector|Rounding|Waypoint|LineStyle|radius|LineJump`. That named 79 strings in
`lib01.jar` and 179 in `vpplatform.jar` and, with them, the classes to read:

| Key string | Class that holds it |
|---|---|
| `connectorStyle.0 … .5` | `lib01.jar!v/cni/b` |
| `Connector.connectorStyle` | `lib01.jar!v/cni/a` — the property registry |
| `DefaultConnectorStyle`, `ConnectorLabelOrientation`, `LineJumpSize` | `vpplatform.jar!v/dap/r` — `VPPreference` |

### 24c. What `v/cni/b#a()V` is, and the four tables it prints

`v.cni.b` holds two `HashMap<String,String>` (`a`, `b`) and one lookup:

```
0000: getstatic  v.cni.b.b:HashMap     // b first: prefix.property.value
0003: … append(prefix) "." property "." value
0035: invokevirtual HashMap.get
0042: ifnonnull 79                     // found → return it
0046: getstatic  v.cni.b.a:HashMap     // else: property.value
0065: … append(property) "." value
0072: invokevirtual HashMap.get
0079: areturn
```

`v/cni/b#a(String,String,int)` — `ev_ef1d1a6f0ee13687…`, 671 instructions — is
therefore *the* value→label table of the properties dialog, and the second
argument of each `put` is the name the program shows for that number:

``` 
03d2: ldc_w "connectionPointType.0"  →  "Round the shape"
03df: ldc_w "connectionPointType.1"  →  "Follow center"
03ec: ldc_w "connectionPointType.2"  →  "Follow Diagram"

03f9: ldc_w "connectorLabelOrientation.0" → "Horizontal Only"
0406: ldc_w "connectorLabelOrientation.1" → "Horizontal or Vertical Only"
0413: ldc_w "connectorLabelOrientation.2" → "Follow Connector Angle"
0420: ldc_w "connectorLabelOrientation.3" → "Follow Connector Angle and Keep Text Up Right"
042d: ldc_w "connectorLabelOrientation.4" → "Follow Diagram"

043a: ldc_w "connectorLineJumps.0" → "Off"
0447: ldc_w "connectorLineJumps.1" → "Arc"
0453: ldc_w "connectorLineJumps.2" → "Gap"
0460: ldc_w "connectorLineJumps.3" → "Square"
046d: ldc_w "connectorLineJumps.4" → "Follow Diagram"

047a: ldc_w "connectorStyle.0" → "Rectilinear"
0487: ldc_w "connectorStyle.1" → "Oblique"
0494: ldc_w "connectorStyle.2" → "Curve"
04a1: ldc_w "connectorStyle.3" → "Follow Diagram"
04ae: ldc_w "connectorStyle.4" → "Round Oblique"
04bb: ldc_w "connectorStyle.5" → "Round Rectilinear"
```

The same table also carries `paintThroughLabel.0 → "Yes"`, `.1 → "No"`,
`.2 → "Follow Diagram"` (`+0x0564`…`+0x0584`), which settles §5a's
`paintConnectorThroughLabel=1`: **1 is "No"** — the line is *not* painted through
the label, i.e. the label masks it, exactly as the build draws it.

### 24d. The ranges the setter accepts, and the defaults it starts from

`vpplatform.jar!v/dap/r` (`VPPreference`) writes each setting as one field plus
one notification; the range check follows the `putfield`:

| Setter | Field | Name it fires | Accepted | Evidence |
|---|---|---|---|---|
| `v/dap/r#d(B)V` | `Ea` | `"DefaultConnectorStyle"` at `+0x000b` | `0`…`5` — `iconst_0` at `+0x0021` … `iconst_5` at `+0x0046`, else `"unknown setting on VPPreference: …DefaultConnectorStyle"` at `+0x0058` | `ev_8dd46c73af6fe8e2…` |
| `v/dap/r#e(B)V` | `Eb` | `"DefaultLineJumps"` at `+0x000b` | `0`…`3` | `ev_87eb8b428fbd1087…` |
| `v/dap/r#i(C)V` | `Kk` | `"ConnectorLabelOrientation"` at `+0x000b` | `0`…`3` (not 4 — "Follow Diagram" is the *connector's* value, never the diagram's) | `ev_9ed6ea1b32029a70…` |
| `v/dap/r#bR(B)V` | `MR` | `"LineJumpSize"` at `+0x000b` | `0`…`2` | — |

In `<init>` the fields are initialised before anything is read:

```
0039: iconst_1
003a: putfield v.dap.r.Ea:byte        // DefaultConnectorStyle = 1
003e: iconst_0
003f: putfield v.dap.r.Eb:byte        // DefaultLineJumps = 0
0711: iconst_0
0712: putfield v.dap.r.Kk:char        // ConnectorLabelOrientation = 0
```

So the program's own defaults are **connectorStyle = 1 (Oblique)**, **line jumps
= 0 (Off)**, **label orientation = 0 (Horizontal Only)**.

The other half of the pair sits in the property registry, `lib01.jar!v/cni/a`
(`ev_35c22a4a6c6ac3d1…`, `#<clinit>`): every *connector* property defaults to
"Follow Diagram" —

| Registry key | Default | Meaning |
|---|---|---|
| `Connector.connectorStyle` at `+0x0e42` | `3L` | Follow Diagram |
| `Connector.connectorLabelOrientation` at `+0x0e22` | `4L` | Follow Diagram |
| `Connector.connectorLineJumps` at `+0x0e2e` | `4L` | Follow Diagram |
| `Connector.paintThroughLabel` at `+0x0e66` | `2L` | Follow Diagram |

A connector therefore stores "inherit", and the diagram answers. §5a's
`connectorStyle=1` is that answer, and 1 is **Oblique**, not rectilinear.

### 24e. This corrects §5a, and the record does not contradict it

§5a read `connectorStyle = 1` as "rectilinear routing" because 1 was the
*default*, not because the label table had been read. It has now:

- `connectorStyle.1` is `"Oblique"`; `Rectilinear` is **0** (`+0x047a`);
- the same table's `0…5` order matches the six values `v/dap/r#d(B)` accepts, so
  the numbering is the storage numbering, not a menu order.

The shipped sample still *looks* orthogonal, and the reason is in the record
itself: a connector does not rely on the diagram's style, it stores its own
routed points. `resources/BaggageSchemas.vpp`, one `Association`:

```
fromPinType=1;  _points="30,30;0,20;";  useFromShapeCenter=T;  useToShapeCenter=T;
```

Every connector in that file carries a `_points` polyline, so the picture is the
stored route whatever `connectorStyle` says — the diagram value only decides how
a **new** connector is laid out. The build's model has the same split
(`link.route` / `link.waypoints` per view), which is why §12f's orthogonal
sample is not evidence for `1 = rectilinear`.

### 24f. What the build now does with it

| File | Change |
|---|---|
| `app/mechanics.json` | 13 rows: the six `connector style:` codes, the five `label orientation:` codes, `connector style property inherits` (3) and `default label orientation` (0). Each carries its `ldc_w` offset in `v/cni/b#a` or the `putfield` in `v/dap/r#<init>` |
| `app/build.mjs` | `SHEET_KEYS` gained the same 13 names, so `MECHANICS.connectorStyleOblique` … exist and a missing row fails the build |
| `app/src/model/connector-style.js` *(new)* | the two value tables, `routeOfStyle` / `roundedOfStyle` / `routeOfLink`, `resolveOrientation` and `labelAngle` — every number imported from the sheet, none typed twice |
| `app/src/model/geometry.js` | `DEFAULT_ROUTE` is `routeOfStyle(MECHANICS.connectorStyle)` — 1 → `direct` (oblique), no longer a hand-written `=== 1 ? 'rect'`; `labelPos(pts, ldx, ldy, orientation)` now takes the code |
| `app/src/ui/render.js`, `canvas.js` | a link draws `routeOfLink(link)` and `roundedOfStyle(link.style)`; its label passes `link.labelOrientation` |
| `app/src/ui/panels.js` | the connector inspector gained **Стиль связи** (six values, default "как на диаграмме") and **Подпись связи** (five values, default "как на диаграмме" → 0) |
| `app/tests/types.mjs` | 7.3b: five orientation codes on a vertical, a diagonal and a right-to-left run; 7.3c: the six style codes and their routes. The unnamed `routePoints` call in 7.3 is now named `'rect'`, because the unnamed default is the program's Oblique |
| `app/tests/smoke.mjs` | the round-7 check "подпись вертикальной связи повёрнута" asserted the **old** behaviour, which was mode 3 while the program's default is 0. It now asserts the default (nothing turned) and points at 7.3b for the turning modes |

Drawn result on the sample: unchanged, because every link in `sample.js` already
carries `route: 'rect'` — the same way every connector in the `.vpp` carries its
own `_points`. What changed is what a *new* link and a *label* do when nothing
overrides them: the label lies flat (0), and the connector follows the diagram's
style, which the sheet says is Oblique.

### 24g. Read, and deliberately not wired

`connectorLineJumps` (`v/cni/b#a+0x043a…+0x0476`: Off / Arc / Gap / Square /
Follow Diagram, size 0…2) and `connectionPointType` (`+0x03d2…+0x03f2`: Round
the shape / Follow center / Follow Diagram) are now **named** in the program's
vocabulary but draw nothing here: line jumps need a crossing test between every
pair of links on the sheet, and the connection point is a drag-time choice the
editor already makes from the side and `t` it stores. Their codes sit in §24c so
a later pass can wire them without re-reading the jars.

**Line jumps are wired in §26** — the crossing test, the five codes, the three
sizes and the geometry measured from the program's own toolbar art.
`connectionPointType` still is not: it stays a drag-time choice.

## 25. Итерация 15 — три дефекта связей: числа взяты из измерений draw.io

Основание — `docs/research/DRAWIO-CONNECTORS.md` (исследование итерации 14, версия 2) и
ТЗ `material/REQUEST-E20-TZ-CONNECTORS.md`. Само приложение Visual Paradigm
здесь не перемерялось: дефекты Д1–Д3 и правила, по которым их закрывать,
измерены на draw.io 20.8.3 и записаны в отчёте с адресами функций движка.
Ниже — только те числа, которые код теперь использует, с местом, откуда они.

### 25a. Конец связи как доля рамки плюс смещение (§3.1)

Формула из `mxGraph.prototype.getConnectionPoint` (mxClient.js 20.8.3):

```
x = bounds.x + point.x · bounds.width  + dx · scale
y = bounds.y + point.y · bounds.height + dy · scale
if (constraint.perimeter) → getPerimeterPoint(state, d)   // проекция на границу
if (round) → округление до целых                          // ТОЛЬКО при отрисовке
```

| Что | Значение | Источник |
|---|---|---|
| доля считается от рамки фигуры | `fx·w`, `fy·h` | `getConnectionPoint`, §3.1 |
| значения вне 0…1 | разрешены, не обрезаются | замер: `entryX=-0.2` → x = bounds.x − 0.2·w (280 при 300 и w=100) |
| `entryDx/entryDy` | в пикселях, добавляются после доли | замер: `entryY=0.5;entryDy=10` на B=(300,40,100,60) → (300, 80) |
| `project` (= `entryPerimeter`) | луч из центра до границы | `getPerimeterPoint`, §3.1; по умолчанию в файлах продукта `entryPerimeter=0` (435 из 486 рёбер корпуса) |
| округление при импорте | нет | в файлах лежат `0.904`, `-0.008`, `1.001` — это обратный пересчёт из целых пикселей |

Код: `attachPoint()` / `endPoint()` в `src/model/geometry.js`; конец хранит
`attach: {fx, fy, dx, dy, project}`, старые файлы продолжают жить на
`side`+`t` (`edgePoint` не изменился).

### 25b. Маркеры концов — списком, а не «или-или» (§3.3, §7.2)

В draw.io маркеров на конце ровно один (`endArrow`), и оба конца независимы:
`startArrow=none;endArrow=none` даёт линию без головок, `startArrow=classic;
endArrow=diamond` — два разных. UML требует большего: ромб агрегации и
стрелка навигации стоят на ОДНОМ конце одновременно, поэтому у нас слот —
список, и он рисуется от фигуры внутрь, со сдвигом на длину уже нарисованного
маркера по последнему сегменту. Расстояния — свои, из начертания
(`HEAD_DIAMOND` 8, `HEAD_OPEN` 8, `HEAD_TRI` 8), новых чисел не заведено.

Семантический конец берётся из модели (`semanticEndOf` → `aggregationOf`),
а не из того, откуда потянули линию: `from`/`to` вида — это только порядок
концов на листе.

### 25c. Скругление числом (§3.4, §7.3)

`mxShape.addPoints`: `arcSize` (по умолчанию `LINE_ARCSIZE = 20`) делится
пополам, и радиус обрезается половиной прилегающего сегмента:

```
r = arcSize / 2
t = min(r · tan(θ/2), |сегмент| / 2)
```

| Значение | Что видно | Источник |
|---|---|---|
| `rounded=1` | радиус 10 | замер §3.4 |
| `rounded=1;arcSize=6` | радиус 3 | там же |
| `rounded=1;arcSize=40` | радиус 20 | там же |
| короткий сегмент 14/6/3 px | 7 / 3 / 1.5 = половина ноги | там же |

У нас `pathD(pts, rounded, arcSize)` читает `arcSize` как РАДИУС (как названо
в ТЗ §7.3: `r = arcSize ?? ROUND_R[rounded]`) и сохраняет прежнюю обрезку
`t ≤ |сегмент|/2`, то есть правило draw.io целиком. Именованные шаги
`small = 6`, `large = 16` остались для старых файлов.

### 25d. Выбор цели при протягивании (§4.4, §7.5)

`mxGraph.getCellAt` обходит детей в обратном порядке и рекурсивно внутрь;
замер: центр ребёнка → ребёнок, пустая область и заголовок контейнера →
контейнер, перекрывающий сосед → верхний по z. Для протягивания конца
`mxEdgeHandler.createMarker().getCell` добавляет: не соединяемая ячейка →
её родитель, контейнер — только если глубже ничего нет, не в себя.

Наше правило (`targetAt` в `src/ui/canvas.js`): кандидаты — все фигуры, чьи
границы содержат точку; глубина — геометрия (меньшая площадь), при равенстве
выше по z; примечание и подпись не соединяемы, поэтому уступают своей рамке.
Флага контейнера в `notation/uml.json` не появилось.

### 25e. Перетаскивание сегмента (§4.5, §7.4)

Замер `mxEdgeSegmentHandler.getPreviewPoints` на ребре с точками
`(240,60) (240,400) (520,400)`:

| Жест | Результат | Что стало с точками |
|---|---|---|
| вертикальный сегмент +30 по x | `(270,60) (270,400) (520,400)` | обе ограничивающие поехали, новых нет |
| горизонтальный сегмент +30 по y | `(240,60) (240,430) (520,430)` | то же |

Прямое ребро (`edgeStyle=none`) при том же жесте вставляет ОДНУ точку. Наш
код повторяет это: `conn-seg` двигает две ограничивающие точки по
перпендикуляру (вторая координата не меняется), `conn-seg-straight` — одна
точка в месте нажатия. Один жест = одна запись отмены.

### 25f. Поля файла (§7.6)

| Поле | Смысл | Умолчание (в файл не пишется) |
|---|---|---|
| `entryPerimeter` | конец приколот к периметру | `false` |
| `noEdgeStyle` | маршрут не пересчитывать, `waypoints` как есть | отсутствует |
| `arcSize` | радиус скругления числом | отсутствует |
| `attach.fx/fy/dx/dy/project` | доля + смещение конца | объект не пишется вовсе |

### 25g. Что осталось за границей итерации

Не сделано сознательно (ТЗ, раздел «Чего не делать»): авто-раскладка,
`curved` как режим маршрута, подсветка кандидата-цели, обход препятствий,
`jettySize`, `entityRelationEdgeStyle`, ER-маркеры. Не проверено на живом
draw.io (в отчёте помечено гипотезой): правило «над содержимым дорожки
контейнер не цель» — у нас оно заменено геометрической глубиной.

## 26. Итерация 16 — проход по главной программе: пересечения связей (§24g закрыт)

§24g назвал четыре кода скачков и оставил их несделанными: «line jumps need a
crossing test between every pair of links». В этом проходе главная программа
открыта заново, коды и умолчания вычитаны до последнего `putfield`, а форма
скачка измерена — не на глаз по скриншоту, а по собственным значкам программы
`icons/VPUML/toolbar/LineJumps*.png`, которые она же и рисует в панели.

### 26a. Вызовы и их ответы

| Шаг | Вызов | Ответ |
|---|---|---|
| открыть главную программу | `core_target_open` на `bin/Visual_Paradigm` | `kind: "unknown"`, 17 166 Б, sha256 `8bad3bce780a…` — тот же shell-лаунчер install4j (§0) |
| найти в ней строки | `native_strings_find --pattern "LineJump"` | `not_supported`: *Couldn't read this as a program: the file is malformed (Unknown file magic)* |
| прочитать функцию | `native_function_pseudocode --function 0x1000` | тот же отказ, дословно |
| **контроль** | `core_target_open` + `native_strings_find "LineJump"` на `jre/bin/java` | `kind: "elf"`; `total: 0`, `coverage.status: "complete"`, ограничение `data_sections_only`; `ev_db8fcac2465583…` |
| открыть код | `core_target_open` на `lib/vpplatform.jar` | `kind: "jar"`, 87 531 369 Б, sha256 `21cb38990702…` |
| искать строки в jar | `native_strings_find "LineJump"` на том же jar | `not_supported`: *A Java program is not native machine code* |

Итог тот же, что в §16a, §20a и §24a: машинного кода у программы нет, и
шестой раз подряд отвечают не нативные инструменты, а **постоянный пул
классов**. Ниже — только то, что вычитано из байткода и из файлов.

### 26b. Пять кодов — из таблицы значений, которую печатает сам диалог

`lib01.jar!v/cni/b#a(String,String,int)V` — та же функция, что в §24c
(`ev_ef1d1a6f0ee13687…`), — держит пары «свойство.значение → подпись». Скачки
занимают в ней пять строк подряд:

| Смещение | Строка | Подпись | Код |
|---|---|---|---|
| `+0x043a` | `connectorLineJumps.0` | `Off` | 0 |
| `+0x0447` | `connectorLineJumps.1` | `Arc` | 1 |
| `+0x0453` | `connectorLineJumps.2` | `Gap` | 2 |
| `+0x0460` | `connectorLineJumps.3` | `Square` | 3 |
| `+0x046d` | `connectorLineJumps.4` | `Follow Diagram` | 4 |

Реестр свойств `lib01.jar!v/cni/a#<clinit>+0x0e2e` ставит связи четвёрку:
`Connector.connectorLineJumps = 4L` — «спроси диаграмму» (`ev_35c22a4a6c6ac3d1…`).
Четвёрка — значение **связи**, а не настройки: у сеттера настройки диапазон
0…3 (ниже).

### 26c. Три умолчания, каждое со своим адресом

`vpplatform.jar!v/dap/r` (`VPPreference`) хранит оба числа полями и будит
слушателей:

| Что | Поле | Где ставится | Значение | Приём |
|---|---|---|---|---|
| `DefaultLineJumps` | `Eb` (byte) | `<init>+0x003e iconst_0` → `+0x003f putfield Eb` | **0** | `e(B)V+0x0021…+0x0039` — 0…3, иначе `"unknown setting on VPPreference: ….DefaultLineJumps"` |
| `LineJumpSize` | `MR` (byte) | `<init>+0x0a27 iconst_0` → `+0x0a28 putfield MR` | **0** | `bR(B)V+0x0021…+0x003e` — три сравнения (0, 1, 2), иначе `"unknown setting on VPPreference: ….LineJumpSize"` |

`bR(B)V` целиком — 25 инструкций: `getfield MR` → `putfield MR` → уведомление
`"LineJumpSize"` со старым и новым `Byte` → три `if` (0, 1, 2) → жалоба в
`v.cbh.af.e(String)` для всего остального. Псевдокод инструмента показывает
эти три проверки как три независимых `if` — так компилятор развернул
`if (v >= 0 && v <= 2)`, и это и есть диапазон кода размера.

Значит: **по умолчанию скачков нет** (0), **размер по умолчанию — младший**
(0), а старший код размера — **2**. Три кода размера — «мелкий/средний/
крупный» в порядке номера.

### 26d. Что говорят записи — и почему §5a не противоречит

У диаграммы своя пара полей, и она лежит в строке `DIAGRAM`, а не в
`DIAGRAM_ELEMENT`:

| Файл | Диаграмм | `connectorLineJumps` у диаграмм | У связей |
|---|---|---|---|
| `myProject.vpp` (16.3, шаблон человека) | 9 | у трёх — **1 = Arc**, у остальных 0 | 5 × `Dependency` и 2 × `Realization` несут `connectorLineJumps=1` |
| `resources/BaggageSchemas.vpp` (17.3, образец) | 6 | все **0** | ни одна связь ключа не пишет |

`connectorLineJumpsSize` в обоих файлах — `0` везде, то есть младший размер,
ровно умолчание из §26c. Так что §5a («`connectorLineJumps / …Size = 0 / 0` —
no line jumps») описывает **образец 17.3**, а не правило программы: тот же
ключ у человека стоит в `1`, и именно дугой нарисованы его зависимости и
реализации. Сборка держит обе записи раздельно: строку образца не трогает, а
новое поле связи читает и пишет.

### 26e. Форма скачка — измерена по значкам программы

В `lib02.jar` лежат четыре иконки панели, 18×18: `LineJumpsOff.png`,
`LineJumpsArc.png`, `LineJumpsGap.png`, `LineJumpsSquare.png`. Они рисуют одно
и то же пересечение: 1 px вертикальная линия (x = 8) пересекает 1 px
горизонтальную (y = 9). Разница — только в горизонтальной:

```
Off                     Arc                      Gap                     Square
.......#..........      .......#..........      .......#..........      .......#..........
##.....##.......++      ##.....##.......++      ##.....##.......++      ##...#######....++
+#.....###......++      +#....#####.....++      +#......#.......++      +#...#.##..#....++
+#####..#..#####++      +#...####..#....++      +#####..#..#####++      +#####..#..#####++
+#......#.......#+      +#####..#..#####++      +#......#.......#+      +#......#.......#+
```

| Что видно в значке | Число | Строка листа |
|---|---|---|
| дуга поднимается на 3 строки (6…8) и занимает x 5…10 | **6 × 3** | `line jump arc: width` / `… height` |
| разрыв: по 2 px с каждой стороны 1 px линии | **2.5** от центра | `line jump gap: half width` |
| квадратная ступенька: x 5…10, 4 строки (5…8) | **6 × 4** | `line jump square: width` / `… height` |

Три кода размера означают, что форма растёт, но **чем** — в банках не сказано.
Проход искал это отдельно и ничего не нашёл:

* строки `linejump` во всех 19 банках — только модель, реестр, экспортёр VSDX
  (`v/cbu/*`, `v/bjr/b`, `v/afr/f`) и пункт панели `v/cpo/ali`; ни одного
  рисующего класса;
* путь связи рисуется через `v/cct/lh` (JGraph-подобный движок внутри
  `lib01.jar`), а геометрию отдаёт объект маршрута `v/cct/dy`: `n()` —
  **три инструкции** `getfield f; areturn` (`ev_96941bc8…`), а `a(D)V` —
  масштабирование точек делением на расстояние (`ev_7a082165…`). Ни `Arc2D`,
  ни `quadTo`, ни константы радиуса в этом классе нет.

Поэтому единственное число, которого в оригинале нет, — **шаг роста**
(2 px на код): оно помечено в листе как `decision`, а не выдано за адрес.
Форма нулевого кода — это ровно рисунок значка, ничего не придумано.

### 26f. Что теперь делает сборка

| Файл | Что изменилось |
|---|---|
| `mechanics.json` | 15 строк: пять кодов, «наследует» (4), три умолчания и шесть измерений значка + шаг роста (`decision`) |
| `build.mjs` | `SHEET_KEYS` — те же 15 имён; пропущенная строка валит сборку |
| `src/model/line-jumps.js` *(новый)* | `LINE_JUMPS`, `JUMP_INHERIT`, `JUMP_OPTIONS`, `resolveJumps(код, кодДиаграммы)`, `jumpShape(размер)`, `segmentCrossing`, `polylineCrossings`, `jumpedPath` — все числа из листа |
| `src/ui/render.js` | маршрут считается один раз на перерисовку (`ctx.routes`), до рисования ищутся пересечения (`markJumps`), связь со своим кодом рисует `d` дугой / разрывом / ступенькой |
| `src/io/umljson.js` | `lineJumps` и `lineJumpsSize` у связи **и** у диаграммы: читаются с проверкой диапазона, пишутся только отличающимися от умолчания (0 и 4 не пишутся) |
| `src/ui/panels.js` | инспектор связи: «Скачки на пересечениях» (5 пунктов) и «Размер скачка» (0…2) |
| `tests/connectors.mjs` | 7 проверок: прямая без кода, вторая линия не прыгает, дуга/разрыв/квадрат настоящими путями в DOM, рост дуги от кода размера, запись кода 1 в файл и отсутствие 4 |

Правила, которые теперь действуют на листе:

* скачок принадлежит **связи**: линия без своего кода не прыгает, даже если её
  пересекают (в значках `Off` — это сплошная линия сквозь пересечение);
* концы сегментов не считаются пересечением — две связи из одной фигуры
  встречаются в её точке привязки;
* пересечение ближе к излому, чем половина скачка, пропускается: лучше прямая,
  чем дуга, вылезшая за угол;
* скруглённые углы (`rounded`/`arcSize`) на связи со скачком не рисуются —
  дуга на дуге не читается; это ограничение, а не правило оригинала;
* порядок обхода: `link.lineJumps` → `diagram.lineJumps` → `DefaultLineJumps`
  (0), ровно как у оригинала: связь хранит 4 «как на диаграмме», диаграмма
  хранит 0…3, настройка — 0…3.

### 26g. Свидетельства

| Вызов | Идентификатор |
|---|---|
| `java_method_show v/dap/r#bR(B)V` (25 инструкций, "LineJumpSize" на `+0x000b`) | `ev_c22d68b6c587ed7b…` |
| `java_method_show v/dap/r#e(B)V` ("DefaultLineJumps") | `ev_570a56b80dcaab6b…` |
| `java_method_show v/dap/r#<init>` (1629 инструкций; `+0x003f` Eb, `+0x0a28` MR) | `ev_0c3c76d2c67cc863…` |
| `db_sqlite_show` таблица `DIAGRAM` файла `myProject.vpp` (9 строк) | `ev_ba01f8d6f86c4387…` |
| `java_method_show v/cct/dy#n()` (3 инструкции) | `ev_96941bc863b4928a…` |
| `java_method_show v/cct/dy#a(D)V` (25) | `ev_7a08216511e8dfd7…` |
| `native_strings_find` на `jre/bin/java` (контроль, 0 совпадений) | `ev_db8fcac24655836f…` |

## 27. Итерация 16б — Curve и скругление прочитаны из кода, а не из draw.io

Раунд 16 нарисовал «Curve» по рецепту draw.io (§7.3: квадратичная цепочка
`Q`) и скруглял углы дугой радиуса 6/16 — оба числа были решением, а не
значением программы. Этот проход нашёл в оригинале и сам маршрут, и сам
срез угла, прогнал найденные классы и заменил ими сборку.

### 27a. Что ответили нативные инструменты на главной программе

| Вызов | Ответ |
|---|---|
| `core_target_open ~/Visual_Paradigm_CE_17.3/bin/Visual_Paradigm` | `kind: "unknown"`, 17 166 B, sha256 `8bad3bce780a06a863e1c8d579f23199fb2da5d39d820803950cb861a95ed882` |
| `native_strings_find <launcher> --pattern Curve` | `not_supported: Couldn't read this as a program: the file is malformed (Unknown file magic)` |
| `native_function_pseudocode <launcher> --function 0x1000` | то же самое, дословно |

Это тот же результат, что в §16a, §18a, §26a: запускаемый файл — shell-скрипт
install4j, машинного кода в нём нет. Дальше — Java-путь Deep mode.

### 27b. Как найти маршрутизатор, когда имена обфусцированы

Английское слово в имени класса не ищется (§18a: `query: "route"` — 0 из
35 230). Работает цепочка ссылок от одного геттера:

| Шаг | Вызов | Что даёт |
|---|---|---|
| 1 | `java_class_users_find --class-name v/cmo/ii --method-name ce` | 8 вызывающих `v.cmo.ii.ce:()I` — это геттер `connectorStyle` у связи |
| 2 | `java_method_show v/dfl/acb#<init>` | конструктор вида связи отдаёт `ce()` в `a(boolean,int)` — `+0x00b4` |
| 3 | `java_method_show v/dfl/acb#a(ZI)V` (57 инструкций) | таблица «код стиля → символ раскладки», `+0x0000…+0x0048`: стиль 0 → `2`, 2 → `3`, 4 → `5`, 5 → `6`, всё остальное → `1` |
| 4 | `java_method_show v/cct/ju#a(C)Lv/cct/an;` (27 инструкций, `tableswitch 2…6`) | символ → класс раскладки: `2`→`v/cct/el`, `3`→`v/cct/ba`, `4`→`v/cct/cs`, `5`→`v/cct/ew`, `6`→`v/cct/ex` |
| 5 | `java_method_show v/cct/ba#l()V` (277) и `v/cct/es#a(D)V` (236) | сам рисунок: Curve — сплайн, Round Oblique / Round Rectilinear — срез угла кубикой |

Отсюда точное соответствие шести стилей (`connectorStyle` 0…5, §22a) их
рисованию:

| Код | Название | Класс раскладки | Что рисует |
|---|---|---|---|
| 0 | Rectilinear | `v/cct/el` | ломаная по точкам маршрута |
| 1 | Oblique | `v/cct/cs` (ветка `default`) | прямая между концами |
| 2 | **Curve** | **`v/cct/ba`** | **натуральный кубический сплайн, 161 отсчёт** |
| 3 | Follow Diagram | `v/cct/cs` | то же, что 1 (после `G(I)` код стал 1) |
| 4 | Round Oblique | `v/cct/ew` | сплайн-раскладка + срез углов |
| 5 | Round Rectilinear | `v/cct/ex` | то же через `v/cct/ey` |

### 27c. Curve — натуральный сплайн по длине хорды, а не `Q` через изломы

`v/cct/ba#l()V` (277 инструкций) в pseudo-Java:

    если у маршрута два узла  ->  moveTo(начало); lineTo(конец); return
    точки = маршрут.g()  (концы + изломы)
    для каждой точки снизу вверх:
        если она совпала с предыдущей  ->  x += 8; y += 8     (+0x0130)
    s = new v/cdi/g(точки)                                    (+0x01a7)
    moveTo(s[0]); для t = 0 … 1 шагом 0.00625: lineTo(s(t))     (+0x0200…+0x0233)

`v/cdi/g#<init>(Point2D[])` задаёт **параметр по длине хорды**: для каждого
звена длина = `|dy|`, если `dx == 0`; `|dx|`, если `dy == 0`; иначе
`sqrt(dx² + dy²)`; затем накопленная сумма делится на всю длину, а последний
узел становится ровно `1.0` (`+0x0033…+0x00e8`). По этому параметру строится
**натуральный кубический сплайн** на каждую ось — `v/cdi/f`: на отрезке
`i` значение `y = c + d·u + e·u² + f·u³`, где `u = t − t_i`, `e = M_i/2`,
`M` — вторые производные из трёхдиагональной системы с `M_0 = M_n = 0`
(`v/cdi/f#a()`, `+0x0027…+0x01a9`; две точки — прямая, `+0x0027`).

Что это значит для листа: кривая **проходит через все изломы**, выгибается
между ними (на трёх точках — заметный «горб» над изломом) и рисуется ломаной
из 161 отсчёта, то есть углов у неё нет, но и гладких `Q`/`C` в файле тоже
нет — ровно как у оригинала.

Проверка — не «на глаз»: классы оригинала (`v/cdi/g` + `v/cdi/f`) вынуты из
`lib01.jar` и прогнаны `javac`/`java` на трёх маршрутах; сборка сверена с их
числами:

| Маршрут | Отсчёт | Оригинал | Сборка |
|---|---|---|---|
| (0,0) (60,80) (160,80) | t = 0.00625 | (0.6250195313, 1.2499609375) | совпало |
| (0,0) (60,80) (160,80) | t = 0.5 | (60, 80) | совпало |
| (0,0) (100,0) (100,100) (200,100) | все 161 | — | max \|Δ\| = 5.4·10⁻¹¹ |
| (80,80) (345,120) (560,120) (420,300) | все 161 | — | max \|Δ\| = 6.8·10⁻¹¹ |

(Остаток — округление эталонного файла до 10 знаков.)

В сборке: `geometry.js#curveSamples` (параметр, сплайн, 161 отсчёт) и
`curvePath`; числа — `MECHANICS.connectorCurveStep` (0.00625) и
`MECHANICS.connectorCurveNudge` (8).

### 27d. Скругление угла — срез 7 px и одна кубика

Стили 4 и 5 идут в `v/cct/es#a(D)V` (236 инструкций). Аргумент — **масштаб
листа**: `v/cct/ju#W()` (185) берёт его из `v/cct/lv#ae()D` и передаёт
раскладке (`+0x0141`). Внутри:

    d = (int)(7.0 * масштаб)                                   +0x00b1…+0x00b6
    для каждого внутреннего узла c (соседи p и n):
        если p, c, n лежат на одной прямой по x или по y:
            lineTo(точка на d от c к n); continue               +0x011e…+0x0139
        t1 = точка на d от c к p     (v/cdi/a#a(Point,Point,int))
        lineTo(t1)                                             +0x013c…+0x0145
        curveTo(t1, c, t2)   где t2 = точка на d от c к n       +0x0146…+0x01a6

То есть угол не «дуга радиуса r»: линия **отступает на 7 px** по обеим ногам,
а между отступами кладётся кубика Безье с контрольными точками
(отступ, сам угол, отступ). Прямые участки — обычные `L`.

В сборке: `ROUND_R = { off: 0, small: 7, large: 7 }` (у оригинала один
размер, второго нет), `pathD` рисует `L t1 C t1 c t2`; `arcSize` из файла
draw.io по-прежнему даёт настоящую дугу `A` — это его собственный ключ.

Одно отличие, названное честно: срез **ограничен половиной короткой ноги**
(`min(7, ul/2, vl/2)`). Оригинал не ограничивает, но и не выпускает ног
короче 2·7 px; у нас излом можно поставить в 3 px от угла, и без ограничения
линия сложилась бы сама на себя. Тест `types.mjs` меряет именно это.

### 27e. Наконечник на кривой — по касательной сплайна

`v/cct/ba#l()+0x01a7…+0x01e1` переписывает предпоследнюю точку массива:

    p = последний узел; s = сплайн(0.9875)
    точка[n−2] = (p.x − (p.x − s.x)·128, p.y − (p.y − s.y)·128)

Это вынесенная далеко назад «ручка направления»: стрелка получает касательную
конца сплайна, а не хорду последнего излома. В сборке то же делает
`render.js`: для `route === 'curve'` наконечники получают **отсчётные** точки
(`samplesPath`/`curveSamples`), а не узлы маршрута; тест меряет косинус между
осью стрелки и последним нарисованным отрезком — 1.0000 (было 0.979 при
ориентации по хорде).

### 27f. Значения листа, добавленные этим проходом

| Значение | Число | Адрес | Где в сборке |
|---|---|---|---|
| шаг отсчёта кривой | 0.00625 | `lib01.jar!v/cct/ba#l()+0x0223` (`ldc2_w 0.00625`) | `MECHANICS.connectorCurveStep` → `geometry.js#curveSamples` |
| сдвиг совпавших точек | 8 px | `lib01.jar!v/cct/ba#l()+0x0160` (`dload 8.0`) | `MECHANICS.connectorCurveNudge` |
| срез угла | 7 px (× масштаб) | `lib01.jar!v/cct/es#a(D)+0x00b1` (`ldc2_w 7.0`) | `MECHANICS.connectorCornerCut` → `geometry.js#ROUND_R` и `pathD` |
| число отсчётов | 161 | вывод из шага (`1 / 0.00625 + 1`) | `curveSamples` (длина массива) |

Стиль 2 → `v/cct/ba` и стили 4/5 → `v/cct/es` — это правило выбора, а не
число, и оно записано в §27b.

### 27g. Свидетельства

| Вызов | Идентификатор |
|---|---|
| `java_method_show v/cct/ba#l()V` (277 инструкций) | `ev_1f0b939afebb64f9…` |
| `java_method_show v/cct/es#a(D)V` (236) | `ev_7c6dc2ff35339467…` |
| `java_method_show v/cdi/g#<init>(Point2D[])` (37) | `ev_90f6d0b6d38fa375…` |
| `java_method_show v/cdi/g#a([D[D)V` (162) | `ev_ef95c9377800da95…` |
| `java_method_show v/cdi/f#a(D)D` (96) | `ev_991a830472244720…` |
| `java_method_show v/cdi/a#a(Point,Point,int)` (41) | `ev_badfe9aa061d7d71…` |
| `java_method_show v/cct/ju#a(C)Lv/cct/an;` (27) | `ev_ddcb121d66963723…` |
| `java_method_show v/cct/ju#W()V` (185, масштаб на `+0x0141`) | `ev_6f8f0af1a0c1f018…` |
| `java_method_show v/cct/lv#ae()D` (3) | `ev_ac2ab3f3badf85f3…` |
| `java_method_show v/dfl/acb#a(ZI)V` (57) | `ev_a922dae948ed4379…` |

### 27h. Чем это проверено в сборке

| Проверка | Было | Стало |
|---|---|---|
| `tests/connectors.mjs` | 54 | **57** — отсчёты против чисел оригинала, излом на кривой, waypoints как узлы, наконечник по касательной |
| `tests/types.mjs` | 242 | **242** — три проверки скругления переписаны на срез 7 px и кубику |
| `tests/smoke.mjs`, `rules.mjs`, `shape-types.mjs`, `stereotypes.mjs` | 33 / 101 / 22 / 16 | без изменений |
| `tests/fixtures/old-v3.json` | 4 611 Б, md5 `3d600cf0…` | байт в байт |

---

## §28. Самосвязь: петля, порог и правила вида

### 28a. Как рисуется петля (замер, не догадка)

Петля — это тот же `routePoints`, у которого оба конца легли на одну сторону:
ветка `dot >= 0.5` даёт шесть точек (конец → выступ 12 px → выступ 24 px →
вдоль → обратно → конец). Замер на `material/corpus-layout/4103.uml.json`,
связь `r2` (`association`, `from = to = e1`, роли `prerequisitesOf` /
`hasPrerequisites`, кратности `*`/`*`, `t = 0.3` и `0.7`, фигура
`s2: x = 60, y = 290, w = 190, h = 170`):

```
right  M 250 341 L 262 341 L 286 341 L 286 409 L 262 409 L 250 409
left   M 60 341 L 48 341 L 24 341 L 24 409 L 48 409 L 60 409
top    M 117 290 L 117 278 L 117 254 L 193 254 L 193 278 L 193 290
bottom M 117 460 L 117 472 L 117 496 L 193 496 L 193 472 L 193 460
```

`t` обоих концов уважается: при `h = 170` `t = 0.3` даёт `y = 341`, `t = 0.7`
— `y = 409`. Самосообщение на диаграмме последовательности — отдельная ветка
`messagePoints` (петля 40×20 вправо от линии жизни), она была и раньше.
Модель, сериализация и маркеры для петли не менялись.

### 28b. Правило вида связи — в нотации, а не в коде

`notation/uml.json → connectors[kind].self`:

| Значение | Виды | Основание |
|---|---|---|
| `allowed` | association, aggregation, composition, realization, dependency, usage, import, merge, extend, assembly, delegation, connector, controlFlow, objectFlow, transition, message, reply, createMessage, destroyMessage, link, deployment, communicationPath, manifest, trace | §11.5 (у ассоциации может быть больше одного конца одного типа), §17.4.4 (сообщение) |
| `forbidden` | generalization, include, extension | `no_cycles_in_generalization` §9.9.4.8; `UseCase::cannot_include_self` §18.2.5.6 |
| `hidden` | `transition.selfInternal` (для связи с `internal: true`) | `state_is_internal` §14.2.4.9: внутренние переходы на диаграммах не показываются |

`hidden` — про чтение чужих файлов: такая связь читается и сохраняется, но не
рисуется, не выбирается и не предлагается инструментом. В нашей модели
внутренний переход живёт не связью, а `internals[]` состояния.

### 28c. Порог и развод концов

| Число | Значение | Откуда |
|---|---|---|
| порог создания петли | 24 px от рамки фигуры | **наше правило**, не из программы: без него клик инструментом связи замыкал бы петлю. Программа порога не имеет |
| минимальный зазор `t` | 0.2 | замер 4103: концы стоят на 0.3 и 0.7; при меньшем зазоре петля вырождается в точку |
| сдвиг при разводе | 0.4 по `t` | выбран так, чтобы из любого `t` попасть в 0…1: при `keep + 0.4 > 1` берётся `keep − 0.4` |

Перетаскивание конца на свою фигуру порога не имеет: намерение там явное.
Создание — имеет: указатель должен отойти от исходной фигуры не меньше чем на
24 px и вернуться.

### 28d. Дубль связи — различители

`relationship-duplicate` (правило практики) сравнивает две связи одной пары по
всем полям, которыми UML их различает: `fromRole`, `toRole`,
`fromMultiplicity`, `toMultiplicity`, `name`, `navigable`,
`fromAggregation`, `toAggregation`. Совпало всё — дубль; разошлось хоть одно —
это две разные связи (пособие, упражнение 4.1: «Полюсам рефлексивных
ассоциаций следует давать имена… Также поступают при наличии двух ассоциаций
между одной парой классов»).

Замер по 48 моделям `material/corpus-layout`: до правки 7 находок
`relationship-duplicate` (4103, 4301, 4306, 4401, 4403, 5223, 5301 — все пары
различаются ролями и кратностями), после — 0. Общее число советов практики:
39 → 32 (`element-isolated` 27, `element-unnamed` 5).

### 28e. Чем проверено в сборке

| Проверка | Было | Стало |
|---|---|---|
| `tests/connectors.mjs` | 57 | **70** — петля, порог (клик, 20 px, 50 px), запреты §9.9.4.8 и §18.2.5.6, `hidden` §14.2.4.9 (чтение, сохранение, нет рисунка), чтение самогенерализации, конец на свою фигуру, самосообщение |
| `tests/rules.mjs` | 101 | **103** — роли/кратности различают, полное совпадение ловится, 4103 чист |
| `tests/fixtures/old-v3.json` | 4 611 Б, md5 `3d600cf0…` | байт в байт |

## 29. Итерация 19 — размер наконечника: `k[]`/`l[]` прочитаны из кода

Проход сделан заново, с нуля, на том же оригинале: сначала главная программа,
потом строка за строкой до места, где рисуется стрелка. Всё ниже — из байткода
этого прохода; свидетели лежат в `investigation.cany/evidence/`.

### 29a. Цепочка вызовов

| Шаг | Инструмент | Что вернул |
|---|---|---|
| главная программа | `core_target_open` на `~/Visual_Paradigm_CE_17.3/bin/Visual_Paradigm` | `kind: "unknown"`, 17 166 Б, sha256 `8bad3bce780a…` — shell-скрипт install4j |
| имена и сообщения в ней | `native_strings_find --pattern Diagram` | `not_supported: Couldn't read this as a program: the file is malformed (Unknown file magic)` |
| псевдокод | `native_function_pseudocode --function 0x1000` | тот же `not_supported` — машинного кода в лаунчере нет |
| сам код | `core_target_open` на `lib/vpplatform.jar` | `kind: "jar"`, 87 531 369 Б, sha256 `21cb38990702…` |
| реестр наконечников | `java_method_show v.cco.b#e()` (193 инструкции, `ev_609d1e0e983dccd37`) | 45 пар «имя → класс»: `Arrow1` → `v/ccq/c`, `SolidArrow1` → `v/ccq/n`, `HollowArrow1` → `v/ccq/h`, `HollowDiamond` → `v/ccq/q` |
| база наконечника | `java_class_show v.cco.a` (`ev_4d173a7ad403caf83`) + `#<init>` (`ev_3682cdb286072ff93`), `#b()` (`ev_bc0b3b4a7c58f0dad`), `#c()` (`ev_fb8fa7f8642545927`) | код размера и две таблицы множителей |
| сами множители | `java_method_show v.ccq/{h,c,n,q}#<init>` (`ev_b26d1f41743101b70`, `ev_770ca37fdc661c722`, `ev_f7a1557c103b54852`, `ev_f0959e91cc272d09b`) | `k[]` и `l[]` каждого painter'а |
| как это попадает в рисунок | `java_method_show v.ccq/h#a(Graphics2D,Point2D,Point2D)` (`ev_182ddaa438aea4987`) → `v.ccq/bk#a(…,DD)` (`ev_acf5bab79f5fa7afa`) | две `double` — длина и ширина — уходят в рисовальщик треугольника |

### 29b. Формула

`v/cco/a` — общая база всех наконечников. В ней:

- поле `x` — КОД РАЗМЕРА, `v/cco/a#<init>+0x0021`: `iconst_2` → `putfield v/cco/a.x`;
- `v/cco/a#b()+0x0001`: `k[f()] · i()` — **длина** (f() = код, i() = поле `a`);
- `v/cco/a#c()+0x0001`: `l[f()] · g()` — **ширина** (g() = поле `b`).

То есть

```
длина = k[код] · a          ширина = l[код] · b
```

где `a` и `b` — базовые размеры, которые каждый painter задаёт в своём `<init>`,
а `k[]`/`l[]` — его же семь множителей. Painter (`v/ccq/h#a`) считает

```
len = k[код] · p() · a      wid = l[код] · p() · b
```

(`+0x000d…+0x003c`; `p()` — поле `w`, `fconst_1` в `<init>+0x001d`, то есть 1.0)
и отдаёт оба числа в `v/ccq/bk#a(Graphics2D,Point2D,Point2D,DD)`, где
`+0x000e` берёт `wid/2` в полуширину основания. Код 2 — заводской, и **обе
таблицы в нём равны 1.0** (индекс 2 ни один painter не пишет, он остаётся от
`dconst_1` базового `<init>`), поэтому базовая стрелка и есть то, что видно по
умолчанию.

### 29c. Таблицы (все семь кодов, 0…6)

| Наконечник | Класс | база `a×b` | `k[]` (длина) | `l[]` (ширина) |
|---|---|---|---|---|
| HollowArrow1 (обобщение, реализация) | `v/ccq/h` | 8 × 11 | 0.7, 0.8, **1.0**, 1.2, 1.4, 2.7, 5.1 | 5/7, 6/7, **1.0**, 8.5/7, 10/7, 20/7, 38/7 |
| Arrow1 (навигация, асинхронное сообщение) | `v/ccq/c` | 8 × 4 | те же | 5/6, 5/6, **1.0**, 7/6, 8/6, 15/6, 27/6 |
| SolidArrow1 (вложенность, синхронное сообщение) | `v/ccq/n` | 7 × 4 | 6/9, 7/9, **1.0**, 11/9, 13/9, 26/9, 50/9 | 0.8, 0.8, **1.0**, 1.2, 1.4, 2.8, 5.2 |
| HollowDiamond (агрегация, композиция) | `v/ccq/q` | 8 × 16 | 8/11, 9/11, **1.0**, 13/11, 16/11, 31/11, 58/11 | 2/3, 17/21, **1.0**, 25/21, 10/7, 20/7, 38/7 |

Крайние коды: 0 уменьшает стрелку до ≈0.67 базовой, 6 растягивает до ≈5.6.
Ширина и длина растут по РАЗНЫМ таблицам, поэтому на коде 6 треугольник не
просто «больше», а заметно уже относительно своей длины.

### 29d. Что теперь делает сборка

| Файл | Что взято из кода |
|---|---|
| `mechanics.json` | +2 значения: `arrow head size codes` (7) и `arrow head size default` (2) — с адресом `v/cco/a#<init>+0x0021` и формулой `v/cco/a#b()+0x0001` / `#c()+0x0001`. Таблицы множителей в лист не вынесены: лист принимает только число, текст и да/нет, а 28 дробей в одной строке — не значение, а данные; они лежат в коде рядом с адресом своего `<init>` (§29c) |
| `src/mechanics.generated.js` | `headSizeCodes`, `headSizeDefault` — генерируются `build.mjs` из листа |
| `src/model/geometry.js` | `HEAD_SCALE` — четыре таблицы из §29c с адресом каждого painter'а; `headMetrics(type, size)` = база × множитель; `headSizeOf()` отбрасывает всё вне 0…6 |
| `src/ui/render.js` | `drawHeads`/`renderHead` берут длину и ширину из `headMetrics`; сдвиг соседних маркеров считается по ДЛИНЕ при том же коде, поэтому ромб и стрелка не наезжают друг на друга ни на 0, ни на 6 |
| `src/io/umljson.js` | `headSizeFrom` / `headSizeTo` — код 2 (умолчание) в файл не пишется, код вне 0…6 при чтении отбрасывается |
| `src/ui/panels.js` | в инспекторе связи, в секции «Концы», два поля: «Наконечник: источник» и «Наконечник: цель», 0…6 с пометкой умолчания |

Умолчание не изменило ни одного пикселя: код 2 — множитель 1.0, поэтому все
прежние замеры (57 проверок связей, 242 типа, `old-v3.json` побайтово) остались
верными, а новые числа появились только там, где код задан.

### 29e. Чем проверено

| Проверка | Было | Стало |
|---|---|---|
| `tests/connectors.mjs` | 70 | **79** — длина/ширина треугольника на кодах 0, 2, 6 в точках листа (5.600×7.857; 8.000×11.000; 40.800×59.714), запись кода 0 в файл, отсутствие умолчания в файле, круг serialize → deserialize → serialize, отказ коду 9, два поля в инспекторе и выбор кода 6, который доходит до модели и до рисунка |
| `tests/types.mjs` | 242 | 242 |
| `tests/smoke.mjs` | 33 | 33 |
| `tests/rules.mjs` | 103 | 103 |
| `tests/shape-types.mjs` | 22 | 22 |
| `tests/stereotypes.mjs` | 16 | 16 |
| `tests/gaps.mjs` | 0 пробелов | 0 |
| `tests/plantuml-import.mjs` | 24 ok, круг 44/48 | то же |
| `tests/fixtures/old-v3.json` | 4 611 Б, md5 `3d600cf0…` | байт в байт |

Что осталось непрочитанным: `v/ccq/h#<init>` пишет `k[]` для кодов 0,1,3,4,5,6,
а индекс 2 оставляет от базового `<init>` — это видно по байткоду, но ЧЕМ
именно программа рисует код 2 в собранном виде (1.0 из `dconst_1` или отдельная
ветка), в этом проходе не проверялось на живом листе: значения совпадают, и
формула от этого не меняется.

## 30. Итерация 20 — проход по главной программе: коробка подписи

Проход начат с главной программы, как требует Deep mode: открыть, искать имена
и сообщения, читать найденное псевдокодом. На этом оригинале первые два шага
упираются в то же, что и в §16–§29, — и это не повод считать проход сделанным
наполовину: контрольный запуск тех же инструментов на `jre/bin/java` доказывает,
что набор работает, а машинного кода Visual Paradigm в установке нет. Дальше
читается то, что действительно рисует подпись, — байткод, и вместе с ним записи,
которые программа пишет сама.

### 30a. Вызовы и их ответы

| Шаг | Инструмент | Ответ |
|---|---|---|
| главная программа | `core_target_open` на `bin/Visual_Paradigm` | `kind: "unknown"`, 17 166 Б, sha256 `8bad3bce780a06a8…`, `target_id: t_8bad3bce780a` — POSIX-скрипт install4j |
| имена и сообщения в ней | `native_strings_find --pattern Diagram` | `not_supported: Couldn't read this as a program: the file is malformed (Unknown file magic)` |
| псевдокод | `native_function_pseudocode --function 0x1000` | тот же `not_supported`, дословно |
| сам код | `core_target_open` на `lib/vpplatform.jar` | `kind: "jar"`, 87 531 369 Б, sha256 `21cb389907020c7f…` |
| те же два инструмента на jar | `native_strings_find`, `native_function_pseudocode` | `not_supported: A Java program is not native machine code.` |
| **контроль**: единственный машинный код в цепочке запуска | `core_target_open` на `jre/bin/java` → `kind: "elf"`, 12 768 Б, sha256 `e94ab2b5afc1e372…`; `native_functions_list` | **24 функции** (`ev_039f0938e8fcba70c…`, `ev_a0b91a39e4fc863ea…`), среди них `main` по `0x950` (401 Б, 112 инструкций) |
| псевдокод `main` | `native_function_pseudocode --function 0x950` | **60 строк псевдо-C** (`ev_2eb7e7fa79e499aca…`): `JLI_InitArgProcessing` → `JLI_AddArgsFromEnvVar("JDK_JAVA_OPTIONS")` → `JLI_PreprocessArg` на каждый аргумент → `JLI_Launch(…, "11.0.16.1+1", …, "openjdk", …)` |
| строки в нём | `native_strings_find --pattern JPEG` | 0 совпадений (`ev_08d4f5689321c0cac…`) — в лаунчере JRE нет ни одной строки приложения, как и ожидалось |

Из псевдокода `main` видно и то, чего в листе не было: **встроенная JRE —
OpenJDK 11.0.16.1+1**, и она получает аргументы приложения как есть. Дальше
машинного кода нет: всё, что рисует лист, — классы `v/*` в jar.

### 30b. Подпись — это модель из шести полей

| Где | Что | Свидетельство |
|---|---|---|
| `openapi.jar!com/vp/plugin/diagram/ICaptionUIModel` | **12 полей-кодов** `SIDE_NONE=1`, `SIDE_NORTH=2`, `SIDE_EAST=3`, `SIDE_SOUTH=4`, `SIDE_WEST=5`, `SIDE_CENTER=6`, `SIDE_INVISIBLE=7`, `SIDE_INSIDENORTH=8`, `SIDE_INSIDEEAST=9`, `SIDE_INSIDESOUTH=10`, `SIDE_INSIDEWEST=11`, `SIDE_FREEMOVE=12`; **14 методов**: `getX/setX`, `getY/setY`, `getWidth/setWidth`, `getHeight/setHeight`, `getSide/setSide`, `isVisible/setVisible`, `setBounds(IIII)`, `copyTo` | `java_class_show` — `ev_0dc070d884c20a644…` |
| `lib01.jar!v/cmo/er` | реализация: 31 поле, 25 методов; аксессоры `a()=x`, `b()=y`, `c()=width`, `d()=height`, `e()=side`, `f()=visible`, `i()=internalWidth`, `j()=internalHeight` | `java_class_show` — `ev_edfade4d7dca71ba3…` |
| `v/cmo/er#<init>()V` | умолчания: `z (visible) = true`, `C = D = Integer.MIN_VALUE` (внутренние ширина/высота «не заданы»), `E = true`; **высота и сторона остаются 0** | `java_method_show` — `ev_5751ec1a057a960d5…` (15 инструкций) |
| `v/cmo/er#e(I)V` | `setSide`: пишет поле `A` **только если `1 ≤ side ≤ 12`**, иначе молча ничего | `ev_6c5944a839ce56663…` (10 инструкций) |
| `v/cmo/er#k()Z` | `return e() == 1` — то есть «сторона не задана» (`SIDE_NONE`) | `ev_91de3e1cc68cf3f70…` |
| `v/cmo/lr#b(Lv/cgm/du;Lv/cmq/fn;Lv/clj/e;)V` | разбор записи: читает `x`→`a(I)`, `y`→`b(I)`, `width`→`c(I)`, `height`→`d(I)`, `side`→`e(I)`, `visible`→`a(Z)`, в этом порядке, с `+0x0001` по `+0x00bd` | `ev_1f42cae05c035189f…` (82 инструкции) |
| `v/bep/i#getCaptionUIModel()` | мост наружу: `return this.a().bg()` — тот же объект, что правит панель свойств | `ev_e6073dfc3a46bae90…` |
| `java_class_users_find v/cmo/er` | 406 обращений из 100 методов в 63 292 классах — модель читают и копируют, но **ни один класс не хранит высоту подписи константой** | `ev_a3ad6f398bf50f7ce…` |

### 30c. Шесть ключей записи и что каждый значит

| Ключ | Поле | Значение |
|---|---|---|
| `@x`, `@y` | `a`, `b` | левый верхний угол коробки подписи **относительно фигуры** |
| `@width`, `@height` | `c`, `d` | размер коробки; `0` в высоте — «по тексту» (так у всех пяти NOTE) |
| `@side` | `A` | **код размещения 1…12**, не расстояние (§30d) |
| `@visible` | `z` | `T`/`F`; `F` у `Activation` (42 записи) и `InteractionOperand` |
| `@internalWidth`, `@internalHeight` | `C`, `D` | `-2147483648` = `Integer.MIN_VALUE` = «не вычислялось»; ровно то, что кладёт `<init>` |

Пример из шаблона человека (`myProject.vpp`): `Class` → `(0, 0, 190, 14, side=12, T)`,
`NOTE` → `(0, 0, 65, 0, side=12, T)` при ширине фигуры 80.
В 17.3-примере `resources/BaggageSchemas.vpp` тот же `Class` хранит
`(15, 40, 51, 15, side=4, T)` — коробку, которую двигали руками.

### 30d. Поправка: `@side` — код размещения, а не отступ

До этого прохода лист читал `@side=12` у примечания как «текст начинается в
12 px от края» (§5b, §7, §8, §15). Это неверно: 12 — это `SIDE_FREEMOVE`,
двенадцатый и последний код перечисления, а `v/cmo/er#e(I)` вообще не примет
значение вне 1…12. Никакого пикселя в этом поле нет.

Что записано в шаблоне человека и в 17.3-примере (по всем строкам
`DIAGRAM_ELEMENT`):

| Фигура | `@side` | Код | Записей |
|---|---|---|---|
| `Class`, `NOTE`, `Package`, `CombinedFragment`, `BPTask`, `DBTable` | 12 | `SIDE_FREEMOVE` — подпись двигается внутри фигуры свободно | 55 / 5 / 7 / 7 / 4 / 2 |
| `InteractionLifeLine`, `Message`, `Association`, `Dependency` | 1 | `SIDE_NONE` — сторона не задана, место считает раскладка | 35 / 62 / 2 / 38 |
| `Part`, `StructuredActivityNode`, `PERTTask` | 8 | `SIDE_INSIDENORTH` — внутри, у верхней кромки | 13 / 4 / 1 |
| `Activation`, `InteractionOperand`, `LostFoundMessageEnd` | 7 | `SIDE_INVISIBLE` — и все они пишут `@visible=F` | 42 / 7 / 8 |
| `Class`, `Actor`, `InteractionLifeLine` в 17.3-примере | 4 | `SIDE_SOUTH` | 3 / 3 / 3 |

Отсюда два следствия, и оба вошли в сборку:

- `@visible=F` вместе с `SIDE_INVISIBLE` — это **«подписи нет»**, а не «подпись
  пустая». Сборка и раньше не рисовала имя активации, но теперь это записано
  как правило, а не как совпадение.
- `SIDE_FREEMOVE` объясняет, почему коробка примечания начинается с `0,0` и
  почему её ширина `w − 15`: подпись не привязана к стороне, её размер задан
  записью. Отступ текста внутри коробки запись не хранит вообще — 12 px в
  сборке остаются её собственным числом (§8).

### 30e. Высота подписи: 14 на строку, без отступа

Высота в записи есть, и она не случайна. По всем `Class` шаблона человека:

| `@height` | Стереотип у класса | Сколько |
|---|---|---|
| 14 | нет | 32 |
| 28 | есть | 15 |
| 42 | есть | 2 |
| 40 | нет | 4 |
| 28 | нет | 2 |

32 против 15 — это «одна строка» против «строка стереотипа + строка имени»:
**14 px на строку**, и всё. 42 — три строки; 40 — не кратно 14, это коробка,
которую тянули мышью (у `SIDE_FREEMOVE` она такой и остаётся), как и два
двадцативосьмипиксельных класса без стереотипа.

В коде константы нет, и это тоже прочитано: `v/cmo/er#<init>()V` оставляет
высоту 0, а `v/bep/i#resetCaptionSize()V`
(`ev_61cb67e31da975f6e…`, 23 инструкции) не считает её сам — он
только поднимает флаг `"pRsCpSz"` через `v/cmo/gj#p(String)`, чтобы пересчёт
сделал проход раскладки. То есть 14 — это то, что программа **измерила** по
11 px Arial, а не число, которое она где-то держит.

### 30f. Что теперь делает сборка

| Файл | Что изменилось |
|---|---|
| `mechanics.json` | +2 значения: `caption line height` (14, запись + адрес) и `note text inset` (12, честно помечено как решение сборки); у `note caption side` исправлен смысл — теперь это код `SIDE_FREEMOVE` с адресами `ICaptionUIModel` и `v/cmo/er#e(I)` |
| `build.mjs` | `SHEET_KEYS` знает оба новых значения, `mechanics.generated.js` собирается из листа |
| `src/model/geometry.js` | `CAPTION_LINE = 14`; `layoutOf` считает `nameH = lines × 14` **без** `2 × PAD_Y` (было `lines × 15 + 6`, то есть 21 и 36 вместо 14 и 28); `NOTE_PAD`/`NOTE_FOLD` берут `noteTextInset`, а `noteCaptionSide` больше не выдаётся за пиксели — он лежит в `CAPTION_SIDE_FREEMOVE`, и по нему примечание выбирает колонку текста: при свободной подписи из ширины вычитается полоса сгиба (`w − 15 − 12`), при закреплённой — только отступы (`w − 2·12`) |
| `src/ui/render.js` | строка имени центрируется в своей полосе 14 px: `renderClassifier`, `renderComponent`, `renderState`, `renderBoundary`, `renderActivity` — стереотип на `y + 7`, имя на `y + 21` |

Строки членов тогда не трогали: у них была своя высота 15 (`member row height`,
§21c), и именно она осталась в `LINE_H`. С итерации 22 это 14 плюс 2 px на
отделение — метрика шрифта, прочитанная в коде (§32d).

### 30g. Чем проверено

| Проверка | Было | Стало |
|---|---|---|
| `tests/connectors.mjs` | 79 | 79 |
| `tests/types.mjs` | 242 | 242 |
| `tests/rules.mjs` | 103 | 103 |
| `tests/smoke.mjs` | 33 | **34** — добавлена проверка «подпись: 14 px на строку, стереотип добавляет строку»: у каждого класса на листе высота коробки подписи (верх корпуса → первый разделитель) равна 14, у класса со стереотипом — 28 |
| `tests/shape-types.mjs` | 22 | 22 |
| `tests/stereotypes.mjs` / `-hygiene` | 16 / 20 | 16 / 20 |
| `tests/recovery.mjs` | 14 | 14 |
| `tests/plantuml-import.mjs` | 24 ok, круг 44/48 | то же |

На листе (снимок `shots/iter20-final.png`, масштаб 70 %): у класса
«Пользователь» со стереотипом «entity» верхняя граница `y=346`, разделитель
под именем `y=366` — полоса **20 px на экране = 28 × 0.70**, стереотип на
`y≈352`, имя на `y≈361`; до правки та же полоса была бы 36 × 0.70 ≈ 25 px.
Строки атрибутов идут с шагом 11 px (15 × 0.70), как и раньше. Тот же замер
в координатах листа делает новая проверка `tests/smoke.mjs`.

Что осталось непрочитанным: метод, который в проходе раскладки пересчитывает
коробку по флагу `pRsCpSz` (кандидат — `v/ua/af#a(v/cmo/ii,ZZ)`, 7 217 байт,
1 800+ инструкций), построчно не разобран; 14 взято из того, что программа
сама записала в 55 коробок, и из того, что высота в модели — не константа.

## 31. Итерация 21 — корпус в круг и панель «Проверки», которая больше не врёт

Прохода по коду в этой итерации не было: правка — в данных корпуса, в нотации,
в правиле и в раскладке связей. Поэтому здесь нет новых адресов функций, зато
есть два числа, которых в оригинале нет вовсе, и оба помечены как решение.

### 31a. Корпус: три поля, которые схема читает, а корпус писал иначе

Э2-бис завёл `represents`, `behaviorRef` (ссылки на id элемента) и `regions`
(массив регионов). Корпус писал туда **имена** и **число** — и чтение честно
снимало ссылку, то есть теряло данные. Замер до правки (с загруженной
нотацией, иначе `kind` подменяется): 48 листов, побайтово чистых 39, с
ремонтами 2 (3401, 3402), только порядок ключей — 7 (4303, 4304, 4307, 5202,
5204, 5206, 5220). `check.mjs` — 7 замечаний.

После правки: **48 из 48 побайтово, `repairs` пуст**, `check.mjs` — **0**.

| Лист | Что было | Что стало | Почему так |
|---|---|---|---|
| 3401 | `represents: "Пользователь (действующее лицо)"`, `"Система регистрации на курсы"` | ссылки сняты, имена сохранены в `documentation` | элементов с такими именами в файле нет: актёр живёт в модели 3.1.1, а `represents` в `uml-model/3` указывает только на элемент того же файла. Выдумывать элемент запрещено — 2 имени не нашлось |
| 3402 | `behaviorRef: "Создать учебный план"` и ещё три | то же, имена в `documentation` | деятельностей в файле нет: это действия вызова деятельности, а сами деятельности — отдельные модели. 4 имени не нашлось |
| 5220 | `regions: 2`, `regions: 1` | `[{id,name}, …]` нужной длины, содержимое пустое | состава регионов в пособии нет; имена — умолчание редактора («Регион 1», «Регион 2»), и это сказано в `documentation` элемента |
| 4202 | операндов нет; `alt` жил строкой в имени фрагмента | `opt` — 1 операнд (покрытие r3…r7), `alt` — 2 операнда (r8, r9) и `[else]` (r10) | сторожа дословно с рисунка 4.2.2 (`material/vision/extracted/4202.json` — оба независимых прочтения), покрытие — по вертикали листа |

Две правки геометрии в 4202 понадобились из-за того же: на рисунке второй
возврат `result` лежит ВНУТРИ `opt`, а `close` — ПОСЛЕ `alt`; на листе было
наоборот (`l7` y 450 → 360, `l11` y 570 → 650). Без этого операнды `alt`
накрывали бы лишнее сообщение.

### 31b. `element-unnamed`: ромб в UML имени не носит

`decision` и `merge` не были помечены `nameless` в `notation/uml.json`, хотя
`choice`/`junction` были. В UML у `DecisionNode` и `MergeNode` имени в
нотации нет — ромб рисуется без подписи, условия живут на рёбрах. Пометка
добавлена; остальные виды деятельности сверены и уже были помечены
(`fork`, `join`, `initial`, `final`, `terminate`, `entryPoint`, `exitPoint`,
`historyDeep`, `historyShallow`). Пять ложных находок на 3401/3402 ушли,
`appliesTo` правила в `notation/rules/practice.json` приведён к тому же
списку (его сверяет `tests/rules.mjs`).

### 31c. `element-isolated`: вложенность на листе, и только у узлов

Развёртывание в этой нотации выражено ГЕОМЕТРИЕЙ — пособие говорит это прямо
(5.1.6: «фигура компонента просто лежит на фигуре узла, и модель об этом не
знает»). Поэтому `nodeNesting` в схему не добавлен: он завёл бы второе
место правды, которое разойдётся с листом. Правило смотрит на лист теми же
функциями, что рисуют редактор (`layoutOf` + попадание прямоугольника в
прямоугольник), и дополнительно уважает `ownerId`, если владелец — узел.

Контейнером считается только вид со `style: "node"` (`node`, `device`,
`executionEnvironment`). Дорожка, пакет и рамка — это ДЕЛЕНИЕ листа, а не
отношение: если освободить всё, что лежит в контейнере, правило ослепнет на
диаграммах деятельности. Проверка на корпусе: пустой ромб 3402 (`e2`, `s11`)
лежит ВНУТРИ дорожки «Студент» — и обязан остаться находкой.

Замер по 5106: **компоненты в листе НЕ лежали внутри узлов** (узлы занимали
y 60…340, компоненты — y 400…700), то есть «6 ложных» были верны по форме и
ложны по смыслу: развёртывание нарисовано не было вовсе (аудит, C8). Лист
переложен по рисунку 5.1.6: три компьютера в левой колонке, каждый со своим
компонентом внутри, коммутатор в середине, принтер сверху, сервер
регистрации справа с тремя процессами, сервер расчётной системы снизу.
`check.mjs` остался чистым, аудит «вложение» — 6 → 0.

### 31d. Параллельные связи: два числа, которых в оригинале нет

Восемь пар законных связей рисовались одной ломаной — вторая линия была
полностью скрыта (4103, 4301, 4306, 4401, 4403, 5223, 5301 ×2). Оригинал
спрошен по записям: в `myProject.vpp` (329 видов, 79 несвязных с сообщениями
коннекторов) ни одной пары с двумя структурными связями нет, зато в
`Visokih.vpp` их **одиннадцать** (342 структурных коннектора), и во всех
одиннадцати у двух связей РАЗНЫЕ `_points` — своя ломаная у каждой, ни одна
пара не совпадает даже первой точкой. То есть программа разводит две линии
между одной парой **сохранённой геометрией каждой связи**, а не сдвигом при
рисовании: новая вторая связь, пока её не провели руками, ляжет поверх первой.
Наш сдвиг — добавление, а не копия, и записан как решение:

* **`parallel connector step` = 0.12** доли стороны между соседними линиями
  (23 px на стороне 190 px). Взято максимальным из тех, что не уводят линию в
  чужую фигуру: при 0.2 пара 5223 (22 px от кромки класса) пошла сквозь
  `RegistrationForm`.
* **`parallel connector edge margin` = 0.06** — ближе к углу конец не
  сдвигается, иначе наконечник уезжает с кромки.

Сдвигаются только связи, у которых совпадает ВСЁ: пара фигур, сторона и доля
конца, маршрут и изломы. Связи одной пары с разными концами уже различимы, и
трогать их нельзя — сдвиг ради сдвига и увёл 5223 в класс. Связь с явным
`attach` не сдвигается вовсе (там решает `attach`), поэтому две такие связи
по-прежнему могут слипнуться — и проверка «совпадение» обязана это назвать
(`selftest.mjs`, случай 17). В файл сдвиг не пишется: это свойство рисунка,
круг корпуса он не трогает.

Побочно: `check.mjs` теперь считает маршрут так же, как редактор — с изломами
(`waypoints`) и с `attach`; раньше он брал только сторону и долю и мерил не то,
что нарисовано.

### 31e. Три старых дефекта раскладки закрыты локально

* **5208** — связь `l16` шла сквозь интерфейс `IDBAccess`; обойдена тремя
  изломами `[[460,600],[460,400],[1125,400]]`.
* **5223** — зазор `s5`/`s8` был 39 px; `s8` поднят на 10 px (стало 49).
* **5301** — две подписи «identifying» (`l5` и `l11`) стояли в одной точке;
  подпись `l11` сдвинута на 22 px (`ldy`).

Осталось (осознанно, это не регрессия и не правится локально): аудит
`--audit` даёт 15 находок «подпись» (в основном 5220 выносит подписи переходов
за левый край листа), 2 «композит» (5220 — состав регионов в пособии не
назван) и 1 «пустой» (пустой ромб 3402 — настоящий дефект модели из аудита,
C3).

### 31f. Защита от повтора

`material/corpus-layout/check.mjs` не входил ни в один набор — поэтому
регрессия и прожила. Теперь есть `app/tests/corpus.mjs`: 48 листов через
`checkSheet` без замечаний, две подложенные поломки (имя вместо id и
потерянный операнд) обязаны быть названы, синхрон двух копий корпуса по
четырём полям, `element-unnamed` 0 на 48 моделях, `element-isolated` 0 на 5106
при живых настоящих сиротах (5204 `e1`, пустой ромб 3402), опыт с «дублем
связи» на 4103 (три варианта: 1 / 0 / 0) и восемь разведённых пар.

| набор | было | стало |
|---|---|---|
| `tests/corpus.mjs` | — | **9** |
| `material/corpus-layout/selftest.mjs` | 15 | **17** (две связи одной пары разведены; слипшиеся концы названы) |
| `tests/rules.mjs` | 103 | 103 |
| `tests/types.mjs` / `smoke` / `connectors` | 242 / 34 / 79 | 242 / 34 / 79 |
| `tests/plantuml-import.mjs` | 24 ok, круг 44/48 | то же |
| `material/corpus-layout/check.mjs` | 7 замечаний | **0** |

## 32. Итерация 22 — проход по главной программе: строка члена — это метрика шрифта, а не 15

Задача этого прохода — не пересказать прежние отчёты, а прочитать те числа,
которыми рисуется **класс**, и либо взять их из кода, либо показать, что их там
нет. Одно нашлось и переписало геометрию: высота строки члена — это
`FontMetrics.getHeight()` программы (14 для Arial 11), а не подобранные 15, и
отделение добавляет ровно **2** px, а не `2 × PAD_Y = 6`.

### 32a. Вызовы и их ответы

| Вызов | Цель | Ответ |
|---|---|---|
| `core_target_open` | `bin/Visual_Paradigm` | `kind: "unknown"`, 17 166 B, sha256 `8bad3bce780a06a8…`, `target_id: t_8bad3bce780a` — POSIX-скрипт установщика |
| `native_strings_find --pattern "Row"` | тот же файл | `not_supported`: *Couldn't read this as a program: the file is malformed (Unknown file magic)* |
| `native_function_pseudocode --function 0x1000` | тот же файл | то же `not_supported`, слово в слово |
| `core_target_open` | `jre/bin/java` (контроль) | `kind: "elf"`, 12 768 B, sha256 `e94ab2b5afc1e372…`, `target_id: t_e94ab2b5afc1` |
| `native_strings_find --pattern "Row"` | `jre/bin/java` | сработал: **0** совпадений, `status: complete` — `ev_2e5aa9f2342…` |
| `native_function_pseudocode --function main` | `jre/bin/java` | сработал: 60 строк псевдо-C от Ghidra, `entry 0x950`, `JLI_InitArgProcessing` — `ev_615f3da8493…` |
| `core_target_open` | `lib/vpplatform.jar` | `kind: "jar"`, 87 531 369 B, sha256 `21cb389907020c7f…`, `target_id: t_21cb38990702` |
| `native_strings_find --pattern "Port"` | `lib/vpplatform.jar` | `not_supported`: *A Java program is not native machine code.* |
| `native_function_pseudocode --function main` | `lib/vpplatform.jar` | то же `not_supported` |

Контроль на `jre/bin/java` стоит в таблице не для полноты: он показывает, что
инструмент работает и отказывает именно цели. Класс программы — байткод, поэтому
имена, настройки и сообщения лежат в constant pool, и дальше шли `java_*`
инструменты (они же пишут `ev_…` в `investigation.cany/evidence/`).

### 32b. От имени к классу: реестр типов фигур

Классы обфусцированы (`v/cnk/vd`), поэтому имя фигуры ищется не в имени класса,
а в реестре: `vpplatform.jar!v/mm#initDiagramElementClassTable` (3 337
инструкций, прочитан страницами по 500 — `ev_50b78ce30fa…`, `ev_205249d356d…`,
`ev_7ced96a7570…`, `ev_a0da7cd5e93…`, `ev_c16d4794032…`, `ev_c05872f4ca1…`,
`ev_1b2e1660439…`). Каждая запись — `ldc "Имя"` + `ldc "v.cnk.X"` +
`registerUIModelClass`:

| Смещение | Имя фигуры | Класс |
|---|---|---|
| `+0x0781` / `+0x0784` | `Class` | `v.cnk.vd` |
| `+0x0fa4` / `+0x0fa7` | `Port` | `v.cnk.ade` |
| `+0x0ce9` / `+0x0cec` | `InteractionLifeLine` | `v.cnk.abb` |
| `+0x0cf3` / `+0x0cf6` | `InteractionOccurrence` | `v.cnk.abc` |

`v.cnk.ade` — это один класс на пять имён: `Port`, `SoaMLRequestPort`,
`SysMLFullPort`, `SysMLProxyPort`, `SoaMLServicePort` (`+0x0fa7`, `+0x12dd`,
`+0x1465`, `+0x14b5`). Без этой таблицы `13×13` ниже нельзя было бы ни к чему
привязать.

### 32c. Единицы: единственный конвертер в программе

`vpplatform.jar!v/due/f#<clinit>` (15 инструкций, `ev_e940825409b…`):

```
0000: ldc2_w 0.0003937007874015748
0003: invokestatic java.awt.Toolkit.getDefaultToolkit()
0006: invokevirtual java.awt.Toolkit.getScreenResolution()I
0009: i2d
000a: dmul
000b: putstatic v.due.f.bc:D
```

`bc = 0.0003937007874015748 × screenResolution`, и два статических метода делят
работу между собой:

| Метод | Байткод | Смысл | Evidence |
|---|---|---|---|
| `v/due/f#a(I)I` | `i2d; getstatic bc; dmul; Math.round; l2i` | `px = round(v · bc)` — миллиметры в пиксели | `ev_4e8717a31d8…` |
| `v/due/f#b(I)I` | `i2d; getstatic bc; ddiv; Math.round; l2i` | `мм = round(px / bc)` | `ev_01001b75385…` |
| `v/due/f#b(v.dvk.i)I` | `ldc "notation:Bounds"` → иначе `"notation:Size"` → `c("height",0)` → `a(I)`; иначе `iconst_m1` | высота фигуры в px, **−1** если размера нет | `ev_c5e7658ca23…` |
| `v/due/f#c(v.dvk.i)I` | то же для `"width"` | ширина фигуры в px | `ev_dcbda577741…` |

`0.0003937007874015748` — это 1/2540 дюйма, то есть сотая доля миллиметра:
слой `notation:` хранит геометрию в миллиметрах и переводит её в пиксели по DPI
экрана. **Сборка этим не пользуется, и это проверено, а не предположено:** в
`.vpp` слой `DEFINITION`, с которым работает сборка, ключей `notation:` не
содержит вообще — класс пишет `width=190; height=170;` и
`_captionUIModel @width=190; @height=14;` прямо в единицах диаграммы, а
конвертер читается только через `notation:Bounds`/`notation:Size`. Поэтому
числа записи переносятся 1:1, как и раньше; строка в лист не добавлена, потому
что её некому читать.

### 32d. Строка члена: `lineHeight × n + 2`

Ветка класса — `vpplatform.jar!v/due/f#a(v.dvk.i,v.dvk.i,v.cmo.gj,v.drc.l,v.drc.b)`,
402 инструкции, `ev_68818f4164e…`:

| Смещение | Инструкция | Что это |
|---|---|---|
| `+0x022c` | `instanceof v.cnk.vd` | ветка **Class** (имя класса — из §32b) |
| `+0x0232` | `ldc "children"` | дети фигуры — отделения |
| `+0x0260` / `+0x0281` / `+0x02a2` | `ldc "AttributeCompartment"` / `"EnumerationCompartment"` / `"OperationCompartment"` | какие отделения существуют и `visible` ли они |
| `+0x0302` | `caption.M() instanceof v.cia.asq` | подпись принадлежит классификатору |
| `+0x0317` | `classifier.q().metaModelElementCount()` | **n** — число членов |
| `+0x0336` | `component.getFontMetrics(caption.bs().g()).getHeight()` | **lineHeight** — метрика шрифта самой подписи |
| `+0x033d` | `imul` | `lineHeight × n` |
| `+0x0342` | `iconst_2; iadd` | **+ 2** — и всё |
| `+0x0346` | `caption.o(caption.P() + block)` | блок членов сдвигает подпись |
| `+0x0351` | `if (caption.R() > block + 20) caption.q(caption.R() − block)` | запас 20 px: программа не ужимает фигуру вплотную к тексту |

Отсюда три правила, и все три — про рисование, а не про запись:

1. **Высота строки члена = высота строки шрифта.** Для Arial 11 это 14 — ровно
   то число, которое каждая запись хранит как `_captionUIModel @height` для
   одной строки (§30). Сборка держала 15 («11 px + 4 px leading»), то есть
   строку на пиксель выше, чем рисует оригинал.
2. **Отделение добавляет 2 px, а не 2 × 3.** `+0x0342` — единственная константа
   в формуле: 1 px над первой строкой и 1 px под последней.
3. **Метрика берётся с живого `Component`** (`v/drc/l#v()`, `+0x02fd`), поэтому
   её нет ни в одной записи: это число момента рисования, а не свойство фигуры.
   Отсюда же и `+0x0351`: фигура не сжимается до текста, у неё остаётся 20 px
   запаса — вот почему в `myProject.vpp` класс 190×170 при двух отделениях.

### 32e. Что из этого теперь читает сборка

| Строка листа | Было | Стало | Адрес |
|---|---:|---:|---|
| `member row height` | 15 (decision) | **14** (code) | `v/due/f#a(…)+0x0336 getHeight(); +0x033d imul` |
| `member compartment padding` | — (было `2 × PAD_Y` = 6) | **2** (code) | `v/due/f#a(…)+0x0342 iconst_2; +0x0343 iadd` |

`app/src/model/geometry.js`: `LINE_H` = 14, `COMPARTMENT_PAD` = 2,
`MEMBER_PAD` = 1; высота отделения стала `rows × 14 + 2` (пустая полоса —
16 px вместо 21), а строка текста внутри отделения встаёт по центру полосы
(`y + 1 + LINE_H/2`), а не по прежнему `PAD_Y = 3`. `app/src/ui/render.js`
берёт ту же `MEMBER_PAD` в трёх местах, где рисуются строки членов.

Проверено после пересборки: `tests/types.mjs` 242, `connectors` 79, `smoke` 34,
`rules` 103, `shape-types` 22, `stereotypes` 16, `stereotype-hygiene` 20,
`corpus` 9, `recovery` 14, `gaps` 17/17, `plantuml-import` 24 ok и круг 44/48 —
всё то же, что до правки; ни одна проверка не ослаблена. Эталонный файл
`old-v3.json` — те же 4 611 Б, md5 `3d600cf0…`.

### 32f. Прочитано, но не используется

| Число | Адрес | Почему не в листе |
|---|---|---|
| порт **13×13** | `v/due/f#a(v.drc.b,v.dvk.i,v.cmo.gj,v.drc.l)+0x0206 bipush 13; bipush 13; new Dimension` (`ev_9d15ced588d…`) | ~~у сборки нет фигуры порта~~ — **используется с §33d**: сборка порт рисует (`render.js#renderPort`, `sample.js`), в палитру он не выведен, но размер у него теперь 13×13 |
| подпись InteractionOccurrence = `fm.getHeight() × строк + 10` | `v/due/f#a(…)+0x00b4 getHeight; +0x00ba imul; +0x00bd bipush 10; +0x00c0 q(I)` | сборка не рисует occurrence |
| конвертер мм↔px | `v/due/f#<clinit>`, `#a(I)`, `#b(I)` (§32c) | сборка читает слой `DEFINITION`, где нет `notation:` |

## 33. Итерация 23 — проход по главной программе: порт 13×13

Задача прохода — прочитать **главную программу** нативными инструментами Deep
mode и взять из неё числа, которыми рисуется то, что сборка уже рисует.
Главная программа — скрипт установщика, поэтому `native_strings_find` и
`native_function_pseudocode` отказывают (§33a, §33b). Код лежит в байткоде, и
одна функция — `v/due/f#a(v.drc.b,v.dvk.i,v.cmo.gj,v.drc.l)`, 518 инструкций —
отдала значение, которое сборка держала выдуманным: **порт 13×13, а не 20×20**
(§33d). Та же функция дала ещё четыре числа; три из них прочитаны и намеренно не
подключены, и в §33e сказано, почему каждое (§33e).

### 33a. Вызовы и их ответы

| Вызов | Цель | Ответ |
|---|---|---|
| `core_target_open` | `~/Visual_Paradigm_CE_17.3/bin/Visual_Paradigm` | `kind: "unknown"`, 17 166 Б, sha256 `8bad3bce780a06a8…`, `target_id: t_8bad3bce780a`, `description: "A file we don't recognise yet"` |
| `native_strings_find --pattern Diagram` | тот же файл | `not_supported`: *Couldn't read this as a program: the file is malformed (Unknown file magic)* |
| `native_strings_find --pattern INSTALL4J` | тот же файл | то же `not_supported`, слово в слово |
| `native_functions_list` | тот же файл | то же `not_supported` |
| `native_function_pseudocode --function 0x1000` | тот же файл | то же `not_supported` |
| `core_target_open` | `jre/bin/java` (контроль) | `kind: "elf"`, 12 768 Б, sha256 `e94ab2b5afc1e372…`, `target_id: t_e94ab2b5afc1` |
| `native_functions_list` | `jre/bin/java` | сработал: `total 24`, `engine: builtin`, `status: partial` — `ev_48fa0ddcb402…` |
| `native_function_pseudocode --function main` | `jre/bin/java` | сработал: `entry 0x950`, `engine: ghidra`, 60 строк псевдо-C, `JLI_InitArgProcessing(0,0)` … — `ev_615f3da8493e…` |
| `core_target_open` | `lib/vpplatform.jar` | `kind: "jar"`, 87 531 369 Б, sha256 `21cb389907020c7f…`, `target_id: t_21cb38990702` |
| `native_strings_find --pattern Port` | `lib/vpplatform.jar` | `not_supported`: *A Java program is not native machine code.* |

Контроль стоит в таблице не для полноты: он показывает, что инструмент работает
и отказывает именно цели. `file(1)` про главную программу говорит то же, что
`core_target_open`: *POSIX shell script, ASCII text executable, with very long
lines (807)*.

### 33b. Почему отказ — это ответ, а не помеха

`bin/Visual_Paradigm` — 17 166 байт шелла, который install4j пишет, чтобы
найти JRE и запустить `java -cp lib/*.jar`. Машинного кода Visual Paradigm в
установке нет: единственный ELF — сам JRE, `uninstaller/uninstall` и
сторонние `.so` внутри jar'ов (§0). Поэтому «функции за тем, что построено» —
это `v/*` классы в `lib01.jar` и `vpplatform.jar`, и адрес у них не `0x…`, а
`jar!класс#метод + смещение байткода`. Дальше шли `java_class_show`,
`java_method_show` и реестр типов фигур; каждая строка §33c–§33e — из них.

### 33c. Функция, в которой лежит размер порта

`vpplatform.jar!v/due/f#a(Lv/drc/b;Lv/dvk/i;Lv/cmo/gj;Lv/drc/l;)V` — 518
инструкций, `public void`, единственная из 12 перегрузок `a`, которая получает
и `v.drc.b`, и `v.cmo.gj`. Это геометрия фигуры при импорте XMI: позиция
берётся из `v/due/f#a(v.dvk.i,v.drc.b)` (66 инструкций, `notation:Bounds` →
`notation:Location`), размер — из `v/due/f#a(v.dvk.i)Ljava/awt/Dimension;`
(36 инструкций, `notation:Bounds` → `notation:Size`, ширина и высота через
`v/due/f#a(I)I`, то есть мм→px, §32c). Дальше — по типу фигуры:

| Смещение | Проверка / константа | Что делает |
|---|---|---|
| `+0x000e` | `instanceof v.cnk.abb` | **InteractionLifeLine**: `+0x0026 bipush 40; putfield Point.y` — линия жизни начинается на y = 40 (§17a) |
| `+0x002c` | `instanceof v.cnk.nh` | **ActivityPartitionHeader**: `+0x0044 bipush 50` → x, `+0x004b bipush 100` → y |
| `+0x00c3` | `instanceof v.cnk.na` | **Activation**: `+0x00df new Dimension; +0x00e3 bipush 9; +0x00e5 f.a(q()); +0x00ea <init>` — ширина 9, высота из модели |
| `+0x010f` | `bipush 40` | активация: `y = 40 + f.a(p())` |
| `+0x0193` | `instanceof v.cnk.we` | **CombinedFragment**: `+0x0193 new Dimension; +0x0197 bipush 80; +0x0199 iconst_0; +0x019a <init>` — 80×0, затем `+0x01a6 putfield height = f.a(t())` |
| `+0x01ac` | `instanceof v.cnk.abc` | **InteractionOccurrence**: `y += f.a(u())` |
| `+0x01ea` | `instanceof v.cnk.ade` | **Port**: `+0x01fd ifnonnull` (только если размера нет) → `+0x0202 new Dimension; +0x0206 bipush 13; +0x0208 bipush 13; +0x020a <init>` |
| `+0x036e` / `+0x037b` | `ldc "notation:Bounds"` / `"notation:Location"` | обратный путь: то, что не пришло из модели, дописывается в запись |

Имена `v.cnk.ade`, `v.cnk.na`, `v.cnk.we` — обфусцированные, поэтому тип
восстановлен не по имени, а по реестру: `v.mm#initDiagramElementClassTable`
(3 337 инструкций, §15a) → `app/notation/shape-types.json`. Строки реестра:

| Имя фигуры | Класс | Смещение в таблице |
|---|---|---|
| `Port`, `SoaMLRequestPort`, `SoaMLServicePort`, `SysMLFullPort`, `SysMLProxyPort` | `v.cnk.ade` | `+0x0fa3` (`+0x0fa4` в §32b), `+0x12d9`, `+0x1325`, `+0x1461`, `+0x14b1` |
| `Activation` | `v.cnk.na` | `+0x0028` |
| `CombinedFragment`, `LoopCombinedFragment`, `AltCombinedFragment` | `v.cnk.we` | `+0x07c4`, `+0x0d86`, `+0x0098` |
| `InteractionLifeLine` | `v.cnk.abb` | `+0x0ce8` |
| `ActivityPartitionHeader` | `v.cnk.nh` | `+0x0068` |

### 33d. Порт 13×13

Ветка `v.cnk.ade` срабатывает только когда у фигуры есть позиция и **нет**
размера — то есть это ровно то число, которым программа отвечает на вопрос
«какого размера порт, если модель молчит». Обе стороны — `bipush 13`, и это
пиксели, а не миллиметры: `new Dimension(13, 13)` строится напрямую, мимо
конвертера `v/due/f#a(I)I`, который вызывают все остальные ветки для чисел из
записи.

Сборка держала **20×20** — число, у которого не было ни записи, ни функции:
`notation/uml.json#shapes.port.defaultSize`, копия в
`src/io/plantuml-layout.js#DEFAULT_SIZE` и два `place(..., 20, 20)` в
`src/model/sample.js`. Теперь 13 в трёх местах и в листе:

| Строка листа | Было | Стало | Адрес |
|---|---:|---:|---|
| `port size` | 20 (ниоткуда) | **13** (code) | `v/due/f#a(v.drc.b,v.dvk.i,v.cmo.gj,v.drc.l)+0x0206 bipush 13; +0x0208 bipush 13; +0x020a invokespecial Dimension.<init>(II)V` |

Видно это на двух листах образца: «Компоненты магазина» (порт `api` на левой
границе «Сервиса заказов») и «Структура заказа» (порт `pay`). Снимок —
`shots/port-13x13.png`, снят со собранного `dist/` при `?model=all&diagram=component`.

### 33e. Прочитано и намеренно не подключено

| Число | Адрес | Почему не в сборке |
|---|---|---|
| активация **ширина 9** | `v/due/f#a(…)+0x00e3 bipush 9` | **запись против кода**: все 42 `Activation` в `myProject.vpp` хранят `width=8`, и 8 — это то, что человек видит в своём проекте; 9 — запасной размер импорта. По правилу §9 запись выигрывает, сборка остаётся на 8. Число записано здесь, чтобы следующая сессия не «исправила» 8 на 9 без этого довода |
| CombinedFragment **ширина 80** | `+0x0197 bipush 80` | это запасной размер фрагмента, у которого в модели нет ширины, а не размер нового фрагмента; сборка рисует фрагмент коробкой с вкладкой и без операндов, так что применить число некуда |
| ActivityPartitionHeader **(50, 100)** | `+0x0044` / `+0x004b` | у сборки нет отдельной фигуры заголовка дорожки: дорожка — одна фигура `swimlane` |
| `Dimension(9, …)` и `y = 40 + f.a(p())` у активации | `+0x00e3` / `+0x010f` | то же, что строка про ширину 9: высота активации в записи своя у каждой из 42 |

### 33f. Что теперь делает сборка

| Файл | Что изменилось |
|---|---|
| `mechanics.json` | строка `port size` = 13, источник — адрес выше |
| `build.mjs` | `SHEET_KEYS['port size'] = 'portSize'`; **новая проверка сборки**: если `notation/uml.json#shapes.port.defaultSize` не равен `portSize` × `portSize`, `build.mjs` завершается с ошибкой и называет оба числа — то есть размер порта больше не может разойтись между листом и данными молча |
| `notation/uml.json` | `shapes.port.defaultSize` 20×20 → 13×13 |
| `src/io/plantuml-layout.js` | `DEFAULT_SIZE.port` 20×20 → 13×13 (копия для Node; её сверяет `plantuml-import.mjs#F4`) |
| `src/model/sample.js` | `PORT = MECHANICS.portSize`; оба `place(...)` для портов берут его вместо литерала 20 |
| `MECHANICS.md` | §7 — строка `port size`; §32f — снято устаревшее «у сборки нет фигуры порта»; этот раздел |

Проверено после пересборки (`node build.mjs` → `node tools/verify.mjs`):

```
shape-types 22 · stereotypes 16 · stereotype-hygiene 20 · gaps 0 (19 кодов)
corpus 10 · recovery 14 · rules 293 · demo 7 · smoke 45 · types 275
connectors 86 · plantuml-import ok (24 ok + круг 44/48) · layout 67 · project-rules 25
src↔dist: 521 файлов, 0 расхождений
эталон old-v3.json: 4 611 Б, md5 3d600cf0… — побайтово
14 наборов зелёных, 0 красных
```

Одна проверка успела покраснеть и была закрыта по существу, а не ослаблена:
`plantuml-import.mjs#F4` («размеры фигур совпадают с `notation/uml.json`»)
нашла вторую копию размера порта — `DEFAULT_SIZE` в `plantuml-layout.js` — и
потребовала привести её к тому же 13. Это и есть довод, что значение читается
из одного места, а не подставлено в одно место.

### 33g. Свидетельства

| Вызов | Evidence id |
|---|---|
| `core_target_open` + 4 отказа `native_*` на `bin/Visual_Paradigm` | отказы не пишут записей: `not_supported` возвращается до анализа. Ответы приведены дословно в §33a |
| `native_functions_list` на `jre/bin/java` | `ev_48fa0ddcb402463c…` |
| `native_function_pseudocode main` на `jre/bin/java` | `ev_615f3da8493eb2ea…` |
| `java_method_show v.due.f#a(Lv/drc/b;Lv/dvk/i;Lv/cmo/gj;Lv/drc/l;)V` (518) | `ev_843137581401260b…` |
| `java_method_show v.due.f#a(Lv/dvk/i;)Ljava/awt/Dimension;` (36) | `ev_8962814b4ef70852…` |
| `java_class_show v.cct.el` (маршрутизатор, для §33e не понадобился) | `ev_8ecbfe0ce3257bbf…` |
| `java_method_show v.cct.el#<clinit>` (9) | `ev_89b8c1b44e0b9032…` |
