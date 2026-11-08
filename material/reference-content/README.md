# material/reference-content — контентная база справочника

Здесь лежит то, что читает встроенный справочник редактора: дерево спецификации,
связи между корпусами и поисковый индекс. Всё собирается тремя скриптами из
материалов, которые уже есть в репозитории; ничего не скачивается и не
устанавливается.

```sh
python3 material/reference-content/parse_spec.py        # → spec-tree.json, spec-sections/
python3 material/reference-content/build_crossrefs.py   # → crossrefs.json
python3 material/reference-content/build_search_index.py # → search-index.json
node    material/reference-content/check_search.mjs     # проверка поиска
```

Порядок важен: `build_crossrefs.py` читает `spec-tree.json`, а
`build_search_index.py` — оба предыдущих файла.

| Файл | Что это | Размер |
| --- | --- | --- |
| `spec-tree.json` | дерево разделов и подразделов UML 2.5.1 с объёмами, признаками Constraints/OCL/таблиц и перекрёстными ссылками | 1,95 МБ |
| `spec-sections/*.md` | 25 разделов верхнего уровня отдельными файлами — браузер грузит только нужный | 2,7 МБ всего |
| `spec-sections/units/*.md` | 61 подраздел шести тяжёлых разделов (9, 11, 14, 15, 16, 17) | 1,1 МБ |
| `spec-sections.json` | отчёт о нарезке: объём каждого файла и сходимость с источником | 3,6 КБ |
| `crossrefs.json` | связи «фигура → пункт», «правило → пункт → фигура», «стереотип → base-тип → фигура», «рисунок → модель», «упражнение → модели» | 287 КБ |
| `search-index.json` | поисковый индекс по всем корпусам: 3 496 документов, 3 148 терминов | 392 КБ (108 КБ в gzip) |

Все три сборщика детерминированы: повторный прогон даёт побайтово те же файлы
(ни времени, ни абсолютных путей внутри нет). `parse_spec.py` и
`build_crossrefs.py` возвращают код 1, если измеренное разошлось с ожидаемым —
числа в документации не могут тихо разъехаться с данными.

Отчёт по всей работе — [`docs/research/REFERENCE-CONTENT.md`](../../docs/research/REFERENCE-CONTENT.md).
