// The sample models.
//
//   buildSampleModel()  — the small shop domain on a Class diagram (what the
//                         first paint shows; matches the reference frame)
//   buildAllTypesModel()— one model, one diagram of EACH of the 14 UML 2.5
//                         types, plus a nested State diagram owned by «Заказ»
//
// Both are built on `uml-model/3`: elements and relationships live in the
// model, diagrams hold views. «Заказ» therefore stands on the Class diagram
// AND on the Composite Structure diagram as the SAME element.

import {
  createModel, createElement, createShape, createRelationship, createLink,
  currentDiagram, setMemberLines, resetNameSeq, createDiagram,
} from './model.js';
import { MECHANICS } from '../mechanics.generated.js';

// The port square is 13×13 in the original, not 20×20: `v/due/f#a(v.drc.b,
// v.dvk.i, v.cmo.gj, v.drc.l)+0x0202…+0x020a` builds `new Dimension(13, 13)`
// for a `v.cnk.ade` (Port) that has a position but no size (MECHANICS §33).
const PORT = MECHANICS.portSize;

/* ------------------------------------------------------------ helpers */

function makeBuilder(m) {
  const element = (kind, name, setup) => {
    const e = createElement(kind, { name });
    if (setup) setup(e);
    m.elements.push(e);
    return e;
  };
  const place = (diagram, el, x, y, w, h) => {
    const s = createShape(el, x, y, { w, h });
    diagram.shapes.push(s);
    return s;
  };
  const connect = (diagram, kind, from, to, extra = {}) => {
    const rel = createRelationship(kind, from.elementId ?? from.id, to.elementId ?? to.id);
    if (extra.name) rel.name = extra.name;
    if (extra.stereotype) rel.stereotype = extra.stereotype;
    if (extra.fromMultiplicity != null) rel.fromMultiplicity = extra.fromMultiplicity;
    if (extra.toMultiplicity != null) rel.toMultiplicity = extra.toMultiplicity;
    if (extra.fromRole) rel.fromRole = extra.fromRole;
    if (extra.toRole) rel.toRole = extra.toRole;
    m.relationships.push(rel);
    const link = createLink(rel,
      { shapeId: from.id, side: extra.fromSide ?? 'right', t: 0.5 },
      { shapeId: to.id, side: extra.toSide ?? 'left', t: 0.5 },
      extra.y != null ? { y: extra.y } : {});
    diagram.links.push(link);
    return link;
  };
  return { element, place, connect };
}

/* ------------------------------------------------------ the shop sample */

export function buildSampleModel() {
  const m = createModel('Пример — Интернет-магазин');
  resetNameSeq();
  const d = currentDiagram(m);
  const { element, place, connect } = makeBuilder(m);

  const person = element('class', 'Пользователь', (e) => {
    setMemberLines(e, 'attributes', '- id: int\n- имя: String\n- email: String');
    setMemberLines(e, 'operations', '+ войти(): bool\n+ профиль(): String');
    e.stereotype = 'entity';
    e.documentation = 'Зарегистрированный пользователь магазина.';
  });
  const customer = element('class', 'Покупатель', (e) => {
    setMemberLines(e, 'attributes', '- адрес: String\n- скидка: int');
    setMemberLines(e, 'operations', '+ корзина(): Корзина');
  });
  const order = element('class', 'Заказ', (e) => {
    setMemberLines(e, 'attributes', '- номер: int\n- дата: Date\n- статус: СтатусЗаказа');
    setMemberLines(e, 'operations', '+ итог(): double\n+ оплатить(): bool');
  });
  const status = element('enumeration', 'СтатусЗаказа', (e) => {
    setMemberLines(e, 'literals', 'НОВЫЙ\nОПЛАЧЕН\nОТПРАВЛЕН\nЗАВЕРШЁН');
  });
  const serializable = element('interface', 'Сериализуемый', (e) => {
    setMemberLines(e, 'operations', '+ вJson(): String');
  });
  element('package', 'shop.model');
  const note = element('note', '', (e) => {
    e.note = 'Ключевой сценарий: покупатель собирает корзину и оформляет заказ.';
  });

  const sPerson = place(d, person, 60, 60);
  const sCustomer = place(d, customer, 320, 40);
  const sOrder = place(d, order, 600, 60);
  const sStatus = place(d, status, 640, 300);
  const sSerial = place(d, serializable, 900, 240);
  place(d, m.elements.find((e) => e.name === 'shop.model'), 40, 300);
  place(d, note, 320, 330);

  connect(d, 'generalization', sCustomer, sPerson, { fromSide: 'left', toSide: 'right' });
  connect(d, 'association', sCustomer, sOrder, {
    name: 'оформляет', fromMultiplicity: '1', toMultiplicity: '0..*',
  });
  connect(d, 'dependency', sOrder, sStatus, { fromSide: 'bottom', toSide: 'top', stereotype: 'use' });
  connect(d, 'realization', sOrder, sSerial, { fromSide: 'right', toSide: 'bottom' });

  return m;
}

/* ------------------------------------------- all fourteen diagram types */

export function buildAllTypesModel() {
  const m = createModel('Пример — все 14 типов UML');
  resetNameSeq();
  const { element, place, connect } = makeBuilder(m);

  const diagram = (name, kind, owner = null) => {
    const d = createDiagram(name, kind, owner);
    m.diagrams.push(d);
    return d;
  };

  // The first diagram replaces the empty one createModel made.
  m.diagrams.length = 0;

  /* --- shared model elements (one element, many views) --------------- */
  const orderCls = element('class', 'Заказ', (e) => {
    setMemberLines(e, 'attributes', '- номер: int\n- дата: Date\n- сумма: double');
    setMemberLines(e, 'operations', '+ итог(): double\n+ оплатить(): bool');
  });
  const customerCls = element('class', 'Покупатель', (e) => {
    setMemberLines(e, 'attributes', '- адрес: String\n- скидка: int');
    setMemberLines(e, 'operations', '+ корзина(): Корзина');
  });
  const statusEnum = element('enumeration', 'СтатусЗаказа', (e) => {
    setMemberLines(e, 'literals', 'НОВЫЙ\nОПЛАЧЕН\nОТПРАВЛЕН\nЗАВЕРШЁН');
  });
  const payIface = element('interface', 'Оплачиваемый', (e) => {
    setMemberLines(e, 'operations', '+ оплатить(): bool');
  });
  const shopPkg = element('package', 'shop.model');
  const uiPkg = element('package', 'shop.ui');

  /* --- 1. Class ------------------------------------------------------ */
  const dClass = diagram('Классы заказа', 'class');
  const cOrder = place(dClass, orderCls, 420, 60);
  const cCustomer = place(dClass, customerCls, 80, 60);
  const cStatus = place(dClass, statusEnum, 460, 330);
  const cPay = place(dClass, payIface, 740, 60);
  const cPkg = place(dClass, shopPkg, 80, 330);
  connect(dClass, 'association', cCustomer, cOrder, {
    name: 'оформляет', fromMultiplicity: '1', toMultiplicity: '0..*',
  });
  connect(dClass, 'dependency', cOrder, cStatus, { fromSide: 'bottom', toSide: 'top', stereotype: 'use' });
  connect(dClass, 'realization', cOrder, cPay, { fromSide: 'right', toSide: 'left' });

  /* --- 2. Component -------------------------------------------------- */
  const dComp = diagram('Компоненты магазина', 'component');
  const webComp = element('component', 'Веб-приложение', (e) => {
    setMemberLines(e, 'operations', '+ оформить()\n+ оплатить()');
  });
  const apiComp = element('component', 'Сервис заказов');
  const payComp = element('component', 'Платёжный шлюз');
  const ordersIface = element('interface', 'Заказы');
  const sWeb = place(dComp, webComp, 80, 80);
  const sApi = place(dComp, apiComp, 380, 80);
  const sPayC = place(dComp, payComp, 380, 280);
  const sOrders = place(dComp, ordersIface, 680, 90);
  const sPort = place(dComp, element('port', 'api'), 360, 120, PORT, PORT);
  connect(dComp, 'assembly', sWeb, sApi, { name: 'REST' });
  connect(dComp, 'dependency', sApi, sOrders, { fromSide: 'right', toSide: 'left', stereotype: 'use' });
  connect(dComp, 'dependency', sApi, sPayC, { fromSide: 'bottom', toSide: 'top', name: 'оплата' });

  /* --- 3. Composite Structure ---------------------------------------- */
  const dCompStruct = diagram('Структура заказа', 'composite');
  const sOrderC = place(dCompStruct, orderCls, 120, 60, 420, 260);
  const partLines = element('part', 'строки: СтрокаЗаказа[]');
  const partPay = element('part', 'оплата: Платёж');
  const sPartLines = place(dCompStruct, partLines, 170, 150, 150, 50);
  const sPartPay = place(dCompStruct, partPay, 370, 150, 140, 50);
  const sPortPay = place(dCompStruct, element('port', 'pay'), 100, 150, PORT, PORT);
  connect(dCompStruct, 'connector', sPartPay, sPortPay, { fromSide: 'left', toSide: 'right', name: 'delegate' });
  connect(dCompStruct, 'connector', sPartLines, sPartPay, { fromSide: 'right', toSide: 'left' });

  /* --- 4. Deployment ------------------------------------------------- */
  const dDeploy = diagram('Развёртывание', 'deployment');
  const nodeApp = element('node', 'Сервер приложений');
  const nodeDb = element('node', 'Сервер СУБД');
  const artWar = element('artifact', 'shop.war');
  const sNodeApp = place(dDeploy, nodeApp, 80, 60, 260, 200);
  const sNodeDb = place(dDeploy, nodeDb, 480, 60, 220, 200);
  const sArt = place(dDeploy, artWar, 120, 140, 140, 70);
  const sDbArt = place(dDeploy, element('artifact', 'shop.sql'), 520, 140, 140, 70);
  connect(dDeploy, 'deployment', sArt, sNodeApp, { fromSide: 'top', toSide: 'top', stereotype: 'deploy' });
  connect(dDeploy, 'communicationPath', sNodeApp, sNodeDb, { name: 'JDBC' });
  connect(dDeploy, 'deployment', sDbArt, sNodeDb, { fromSide: 'top', toSide: 'top', stereotype: 'deploy' });

  /* --- 5. Object ----------------------------------------------------- */
  const dObj = diagram('Объекты заказа', 'object');
  const o1 = element('object', 'заказ1: Заказ', (e) => {
    setMemberLines(e, 'slots', 'номер = 1042\nстатус = ОПЛАЧЕН\nсумма = 3490.00');
  });
  const o2 = element('object', 'покупатель1: Покупатель', (e) => {
    setMemberLines(e, 'slots', 'адрес = «Ленина, 5»\nскидка = 5');
  });
  const sO1 = place(dObj, o1, 120, 80, 220, 100);
  const sO2 = place(dObj, o2, 460, 80, 220, 100);
  connect(dObj, 'link', sO1, sO2, { name: 'владелец', fromMultiplicity: '1', toMultiplicity: '1' });

  /* --- 6. Package ---------------------------------------------------- */
  const dPkg = diagram('Пакеты', 'package');
  const sPkg1 = place(dPkg, shopPkg, 80, 80, 180, 120);
  const sPkg2 = place(dPkg, uiPkg, 420, 80, 180, 120);
  const sPkg3 = place(dPkg, element('package', 'shop.data'), 420, 280, 180, 120);
  connect(dPkg, 'dependency', sPkg2, sPkg1, { name: 'использует', fromSide: 'left', toSide: 'right' });
  connect(dPkg, 'import', sPkg3, sPkg1, { fromSide: 'top', toSide: 'bottom', stereotype: 'import' });

  /* --- 7. Profile ---------------------------------------------------- */
  const dProfile = diagram('Профиль магазина', 'profile');
  const prof = element('profile', 'shop.profile');
  const stereoEntity = element('stereotype', 'Entity', (e) => {
    setMemberLines(e, 'attributes', '+ таблица: String');
  });
  const metaClass = element('metaclass', 'Class');
  const sProf = place(dProfile, prof, 80, 60, 180, 110);
  const sStereo = place(dProfile, stereoEntity, 360, 60, 180, 100);
  const sMeta = place(dProfile, metaClass, 620, 60, 160, 80);
  connect(dProfile, 'extension', sStereo, sMeta, { fromSide: 'right', toSide: 'left' });

  /* --- 8. Activity --------------------------------------------------- */
  const dAct = diagram('Оформление заказа', 'activity');
  const actLane = element('swimlane', 'Покупатель');
  const actInitial = element('initial', '');
  const actPay = element('action', 'Оплатить');
  const actDecide = element('decision', 'Оплата прошла?');
  const actShip = element('action', 'Отправить');
  const actCancel = element('action', 'Отменить');
  const actFinal = element('final', '');
  place(dAct, actLane, 40, 40, 520, 420);
  const aInit = place(dAct, actInitial, 120, 90);
  const aPay = place(dAct, actPay, 100, 150, 160, 50);
  const aDec = place(dAct, actDecide, 120, 250, 130, 80);
  const aShip = place(dAct, actShip, 340, 150, 150, 50);
  const aCancel = place(dAct, actCancel, 100, 360, 150, 50);
  const aFinal = place(dAct, actFinal, 360, 375);
  connect(dAct, 'controlFlow', aInit, aPay, { fromSide: 'bottom', toSide: 'top' });
  connect(dAct, 'controlFlow', aPay, aDec, { fromSide: 'bottom', toSide: 'top' });
  connect(dAct, 'controlFlow', aDec, aShip, { fromSide: 'right', toSide: 'left', name: 'да' });
  connect(dAct, 'controlFlow', aDec, aCancel, { fromSide: 'bottom', toSide: 'top', name: 'нет' });
  connect(dAct, 'controlFlow', aShip, aFinal, { fromSide: 'bottom', toSide: 'top' });
  connect(dAct, 'controlFlow', aCancel, aFinal, { fromSide: 'right', toSide: 'left' });

  /* --- 9. State Machine ---------------------------------------------- */
  const dState = diagram('Состояния заказа', 'state');
  const stNew = element('state', 'Новый', (e) => { e.entry = ['создать корзину']; });
  const stPaid = element('state', 'Оплачен', (e) => { e.entry = ['зафиксировать оплату']; e.exit = ['передать на склад']; });
  const stSent = element('state', 'Отправлен', (e) => { e.do = ['ждать доставку']; });
  const stFinal = element('final', '');
  const stInit = element('initial', '');
  const stChoice = element('choice', '');
  const sInit = place(dState, stInit, 100, 80);
  const sNew = place(dState, stNew, 90, 130, 160, 70);
  const sPaid = place(dState, stPaid, 330, 130, 170, 80);
  const sSent = place(dState, stSent, 570, 130, 160, 70);
  const sChoice = place(dState, stChoice, 390, 300);
  const sFin = place(dState, stFinal, 590, 300);
  connect(dState, 'transition', sInit, sNew, { fromSide: 'bottom', toSide: 'top' });
  connect(dState, 'transition', sNew, sPaid, { fromSide: 'right', toSide: 'left', name: 'оплата' });
  connect(dState, 'transition', sPaid, sSent, { fromSide: 'right', toSide: 'left', name: 'сборка' });
  connect(dState, 'transition', sPaid, sChoice, { fromSide: 'bottom', toSide: 'top', name: 'отмена' });
  connect(dState, 'transition', sChoice, sFin, { fromSide: 'right', toSide: 'left', name: 'возврат' });

  /* --- 10. Use Case --------------------------------------------------- */
  const dUse = diagram('Варианты использования', 'usecase');
  const actorCustomer = element('actor', 'Покупатель');
  const ucOrder = element('usecase', 'Оформить заказ');
  const ucPay = element('usecase', 'Оплатить заказ');
  const ucTrack = element('usecase', 'Отследить доставку');
  const boundary = element('systemBoundary', 'Интернет-магазин');
  const sBoundary = place(dUse, boundary, 260, 40, 520, 380);
  const sActor = place(dUse, actorCustomer, 100, 160, 40, 80);
  const sUcOrder = place(dUse, ucOrder, 320, 90, 160, 70);
  const sUcPay = place(dUse, ucPay, 560, 90, 160, 70);
  const sUcTrack = place(dUse, ucTrack, 320, 250, 170, 70);
  connect(dUse, 'association', sActor, sUcOrder, { name: '' });
  connect(dUse, 'include', sUcOrder, sUcPay, { stereotype: 'include' });
  connect(dUse, 'association', sActor, sUcTrack, { fromSide: 'right', toSide: 'left' });

  /* --- 11. Sequence --------------------------------------------------- */
  const dSeq = diagram('Оформление (последовательность)', 'sequence');
  const llCustomer = element('lifeline', ':Покупатель');
  const llShop = element('lifeline', ':Магазин');
  const llPay = element('lifeline', ':Платёжный шлюз');
  const sLl1 = place(dSeq, llCustomer, 100, 60, 120, 360);
  const sLl2 = place(dSeq, llShop, 360, 60, 120, 360);
  const sLl3 = place(dSeq, llPay, 620, 60, 120, 360);
  const actShopLine = element('activation', '');
  const actPayLine = element('activation', '');
  const actCustLine = element('activation', '');
  place(dSeq, actCustLine, 156, 140, 8, 160);
  place(dSeq, actShopLine, 416, 140, 8, 150);
  place(dSeq, actPayLine, 676, 180, 8, 80);
  connect(dSeq, 'message', sLl1, sLl2, { name: 'оформить()', y: 150 });
  connect(dSeq, 'message', sLl2, sLl3, { name: 'оплатить(сумма)', y: 190 });
  connect(dSeq, 'reply', sLl3, sLl2, { name: 'ok', y: 230 });
  connect(dSeq, 'message', sLl2, sLl1, { name: 'номер заказа', y: 270 });
  const frag = element('fragment', 'если оплата не прошла', (e) => { e.operator = 'alt'; });
  place(dSeq, frag, 80, 125, 700, 195);

  /* --- 12. Communication --------------------------------------------- */
  const dComm = diagram('Связи объектов', 'communication');
  const co1 = element('object', 'заказ1: Заказ');
  const co2 = element('object', 'покупатель1: Покупатель');
  const co3 = element('object', 'шлюз1: Платёжный шлюз');
  const sCo1 = place(dComm, co1, 140, 80, 180, 80);
  const sCo2 = place(dComm, co2, 460, 80, 180, 80);
  const sCo3 = place(dComm, co3, 300, 280, 190, 80);
  connect(dComm, 'link', sCo1, sCo2, { name: 'оформить()' });
  connect(dComm, 'link', sCo1, sCo3, { name: 'оплатить()' });
  connect(dComm, 'link', sCo2, sCo3, { name: 'подтвердить()' });

  /* --- 13. Timing ----------------------------------------------------- */
  const dTime = diagram('Время оплаты', 'timing');
  const laneOrder = element('timingLane', 'Заказ', (e) => {
    e.timeline = [
      { state: 'Новый', from: 0, to: 25 },
      { state: 'Оплачен', from: 25, to: 60 },
      { state: 'Отправлен', from: 60, to: 100 },
    ];
  });
  const lanePay = element('timingLane', 'Платёж', (e) => {
    e.timeline = [
      { state: 'Ожидание', from: 0, to: 20 },
      { state: 'Проверка', from: 20, to: 40 },
      { state: 'Успех', from: 40, to: 100 },
    ];
  });
  place(dTime, laneOrder, 80, 80, 520, 90);
  place(dTime, lanePay, 80, 200, 520, 90);

  /* --- 14. Interaction Overview --------------------------------------- */
  const dIo = diagram('Обзор взаимодействий', 'interaction-overview');
  const ioStart = element('initial', '');
  const ioRef1 = element('interaction', 'Оформить');
  const ioDec = element('decision', 'Оплата?');
  const ioRef2 = element('interaction', 'Оплатить');
  const ioRef3 = element('interaction', 'Отменить');
  const ioEnd = element('final', '');
  const iStart = place(dIo, ioStart, 80, 160);
  const iRef1 = place(dIo, ioRef1, 160, 120, 220, 90);
  const iDec = place(dIo, ioDec, 440, 140, 80, 60);
  const iRef2 = place(dIo, ioRef2, 580, 60, 220, 90);
  const iRef3 = place(dIo, ioRef3, 580, 240, 220, 90);
  const iEnd = place(dIo, ioEnd, 860, 150);
  connect(dIo, 'controlFlow', iStart, iRef1, { fromSide: 'right', toSide: 'left' });
  connect(dIo, 'controlFlow', iRef1, iDec, { fromSide: 'right', toSide: 'left' });
  connect(dIo, 'controlFlow', iDec, iRef2, { fromSide: 'right', toSide: 'left', name: 'да' });
  connect(dIo, 'controlFlow', iDec, iRef3, { fromSide: 'bottom', toSide: 'left', name: 'нет' });
  connect(dIo, 'controlFlow', iRef2, iEnd, { fromSide: 'right', toSide: 'left' });

  /* --- a nested diagram: it belongs to «Заказ» ------------------------ */
  const dNested = diagram('Состояния заказа (вложенная)', 'state', orderCls.id);
  const nsInit = element('initial', '');
  const nsNew = element('state', 'Новый');
  const nsPaid = element('state', 'Оплачен');
  const nsDone = element('final', '');
  const nInit = place(dNested, nsInit, 80, 80);
  const nNew = place(dNested, nsNew, 70, 130, 150, 70);
  const nPaid = place(dNested, nsPaid, 320, 130, 150, 70);
  const nDone = place(dNested, nsDone, 560, 160);
  connect(dNested, 'transition', nInit, nNew, { fromSide: 'bottom', toSide: 'top' });
  connect(dNested, 'transition', nNew, nPaid, { fromSide: 'right', toSide: 'left', name: 'оплата' });
  connect(dNested, 'transition', nPaid, nDone, { fromSide: 'right', toSide: 'left' });

  m.currentDiagramId = dClass.id;
  return m;
}
