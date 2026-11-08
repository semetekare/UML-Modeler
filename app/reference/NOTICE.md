# NOTICE — сторонние права в этом приложении

Этот файл — исполнение условия (1) лицензии OMG. Он должен лежать рядом с
приложением и открываться из корпуса «Спецификация» в справочнике.

---

## 1. Текст спецификации UML 2.5.1

Приложение содержит **полный текст** спецификации (25 разделов, 3 690 пунктов),
а также имена констрейнтов, номера пунктов, заголовки и выражения OCL:

> **OMG® Unified Modeling Language® (OMG UML®), Version 2.5.1**
> OMG Document Number **formal/2017-12-05**, декабрь 2017
> <https://www.omg.org/spec/UML/2.5.1/>

Полный английский текст стандарта в поставку **не входит**. `reference/spec/*.json`
содержит номера пунктов, заголовки разделов, имена констрейнтов и OCL — без прозы.
Так собирается командой `node tools/build-reference.mjs --lang=en --no-full-text
--out=<каталог>`; английские абзацы, списки и примеры в сборке отсутствуют, а
исходники текста (`reference/spec/`, `material/reference-content/spec-sections/`)
в репозиторий не входят и остаются на машине владельца.

Рядом лежит **русский перевод** (`reference/spec-ru/`, собран из
`material/spec-ru/`) — он сохранён полностью и входит и в поставку, и в репозиторий. Официальный текст стандарта —
английский (`formal/2017-12-05`); перевод **неофициальный**: сделан для личного
пользования, OMG его не заверял и не проверял. Официальным текстом считается
только английский оригинал; перевод читается как подстрочник к нему и никогда
его не заменяет.

### Уведомление об авторских правах

Copyright © 2009-2013 88Solutions
Copyright © 2009-2010 Artisan Software Tools
Copyright © 2001-2013 Adaptive
Copyright © 2009-2010 Armstrong Process Group, Inc.
Copyright © 2001-2010 Alcatel
Copyright © 2001-2010 Borland Software Corporation
Copyright © 2009-2010 Commissariat à l'Energie Atomique
Copyright © 2001-2010 Computer Associates International, Inc.
Copyright © 2009-2010 Computer Sciences Corporation
Copyright © 2009-2013 Data Access Technologies, Inc. (Model Driven Solutions)
Copyright © 2009-2013 Deere & Company
Copyright © 2009-2013 European Aeronautic Defence and Space Company
Copyright © 2001-2013 Fujitsu
Copyright © 2001-2010 Hewlett-Packard Company
Copyright © 2001-2010 I-Logix Inc.
Copyright © 2001-2013 International Business Machines Corporation
Copyright © 2001-2010 IONA Technologies
Copyright © 2013 Ivar Jacobson International SA
Copyright © 2001-2010 Kabira Technologies, Inc.
Copyright © 2009-2010 Lockheed Martin
Copyright © 2001-2010 MEGA International
Copyright © 2009-2010 Mentor Graphics Corporation
Copyright © 2009-2013 Microsoft Corporation
Copyright © 2001-2010 Motorola, Inc.
Copyright © 2009-2010 National Aeronautics and Space Administration
Copyright © 2009-2013 No Magic, Inc.
Copyright © 1997-2017 Object Management Group, Inc
Copyright © 2009-2010 oose Innovative Informatik GmbH
Copyright © 2001-2010 Oracle Corporation
Copyright © 2009-2010 Oslo Software, Inc.
Copyright © 2009-2010 Purdue University
Copyright © 2012-2013 Simula Research Laboratory
Copyright © 2009-2010 SINTEF
Copyright © 2001-2010 SOFTEAM
Copyright © 2009-2013 Sparx Systems Pty Ltd
Copyright © 2001-2010 Telefonaktiebolaget LM Ericsson
Copyright © 2009-2010 THALES
Copyright © 2001-2013 Unisys
Copyright © 2001-2010 X-Change Technologies Group, LLC

### Условия использования (дословно, из документа, стр. iii)

> Subject to all of the terms and conditions below, the owners of the copyright
> in this specification hereby grant you a fully-paid up, non-exclusive,
> nontransferable, perpetual, worldwide license (without the right to
> sublicense), to use this specification to create and distribute software and
> special purpose specifications that are based upon this specification, and to
> use, copy, and distribute this specification as provided under the Copyright
> Act; provided that: (1) both the copyright notice identified above and this
> permission notice appear on any copies of this specification; (2) the use of
> the specifications is for informational purposes and will not be copied or
> posted on any network computer or broadcast in any media and will not be
> otherwise resold or transferred for commercial purposes; and (3) no
> modifications are made to this specification. This limited permission
> automatically terminates without notice if you breach any of these terms or
> conditions. Upon termination, you will destroy immediately any copies of the
> specifications in your possession or control.

### Как это приложение соблюдает три условия

| Условие | Как выполнено |
|---|---|
| (1) уведомление и разрешение приложены | этот файл; он же показывается на первой странице полки «Спецификация» в справочнике |
| (2) не копировать и не размещать в сети | **выполнено**: английская проза стандарта в поставку и в репозиторий не входит; `reference/spec/*.json` несёт только номера, заголовки, имена констрейнтов и OCL (`build-reference.mjs --no-full-text`) |
| (3) без изменений | текст стандарта не изменялся и не переводился: он разобран на блоки без правки слов |

**Что добавлено нами:** русские карточки нотации, пояснения к правилам,
связи между корпусами и поиск. Они лежат отдельно от текста стандарта и
помечены — читатель всегда видит, где OMG, а где мы.

---

## 2. Профиль стереотипов

`app/material/stereotypes.xml` — профиль стереотипов из шаблона, 428 записей. Это **единственный чужой файл данных** в проекте.

Он используется как справочник: приложение читает имена стереотипов,
base-типы и определения tagged-значений, чтобы человек работал с теми же
стереотипами. Графика из архива `stereotypes_files.zip`
(23 GIF) **не копируется**: все 15 рисунков нарисованы заново
(`material/pictograms/`), см. `docs/uml/pictograms.md`.

---

## 3. Рисунки учебного пособия

`app/reference/vp163/` — 54 снимка окна из учебного пособия
ВМК МГУ (Малышко В. В.). Они **не входят в справочник** и не показываются
пользователю; лежат для сверки при разработке.

В справочнике вместо них — наш собственный рендер моделей корпуса
(`material/corpus-layout/`) тем же движком, что рисует лист.

---

## 3a. Русский перевод

Перевод 25 разделов и 315 терминов словаря — работа владельца проекта, не
документ OMG. Он не входит в поставку стандарта, не заверялся OMG и не может
цитироваться как текст спецификации: официальный текст — английский
(`formal/2017-12-05`). Блоки OCL и ASCII-арта метамодели в переводе **не
переведены и не изменены** — они совпадают с оригиналом побайтово, это
проверяется сборкой.

---

## 4. Шрифт

Inter — SIL Open Font License 1.1. Встроен в прототип справочника как base64.

---

## 5. Что делать, если вы правообладатель

Напишите — спорные материалы будут убраны. Контакт: notice@kunni-course.site.
