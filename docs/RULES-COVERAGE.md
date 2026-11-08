# Покрытие правил проверки — указатель

Этот файл не хранит чисел, написанных руками: он собирается
[`material/rules-coverage/build.mjs`](../material/rules-coverage/build.mjs) из
перевода спецификации, нотации и набора правил. Полная сводка —
[`material/rules-coverage/report.md`](../material/rules-coverage/report.md),
машиночитаемые данные — [`coverage.json`](../material/rules-coverage/coverage.json),
очередь правил — [`TO-IMPLEMENT.md`](../material/rules-coverage/TO-IMPLEMENT.md),
источник правил — [`RULES-SOURCE.md`](RULES-SOURCE.md).

| Показатель | Значение |
| --- | ---: |
| Констрейнтов UML 2.5.1 | 449 |
| В области (метакласс выражен фигурой или связью) | 166 |
| Вне области | 283 |
| Исполняется правил | 52 |
| Записано правил | 58 |

| Статус | Констрейнтов |
| --- | ---: |
| `executable` | 52 |
| `todo` | 0 |
| `tautology` | 3 |
| `gap` | 87 |
| `no-ocl` | 24 |
| `out-of-scope` | 283 |
| **сумма** | **449** |

Значения статусов:

* `executable` — правило записано, функция есть;
* `todo` — всё нужное в модели есть, правило ещё не написано;
* `tautology` — в этой схеме нарушить нечем;
* `gap` — нет поля или конструкции модели;
* `no-ocl` — в стандарте у констрейнта нет OCL;
* `out-of-scope` — метакласса нет ни одной фигурой или связью нотации.

Слой практики ([`practice.json`](../app/notation/rules/practice.json)) в этот
счёт не входит: у советов практики нет пункта UML, и знаменатель — только
констрейнты стандарта.

Пересборка: `node material/rules-coverage/build.mjs`; проверка расхождений:
`node material/rules-coverage/build.mjs --check`.
