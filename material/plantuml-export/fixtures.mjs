export const FIXTURES = {
  component: {
    diagram: 'component',
    elements: [
      { id: 'e1', kind: 'component', name: 'Биллинг', attributes: [{ vis: 'public', name: 'версия', type: 'string' }] },
      { id: 'e2', kind: 'component', name: 'Оплата' },
      { id: 'e3', kind: 'interface', name: 'IPayment' },
      { id: 'e4', kind: 'port', name: 'http' },
      { id: 'e5', kind: 'artifact', name: 'billing.jar' },
    ],
    relationships: [
      { id: 'r1', kind: 'dependency', from: 'e1', to: 'e3' },
      { id: 'r2', kind: 'realization', from: 'e2', to: 'e3' },
      { id: 'r3', kind: 'delegation', from: 'e4', to: 'e1' },
      { id: 'r4', kind: 'manifest', from: 'e5', to: 'e1' },
    ],
    shapes: [
      { id: 's1', elementId: 'e1', x: 200, y: 60, w: 240, h: 160 },
      { id: 's2', elementId: 'e2', x: 200, y: 300, w: 190, h: 120 },
      { id: 's3', elementId: 'e3', x: 520, y: 60, w: 190, h: 110 },
      { id: 's4', elementId: 'e4', x: 180, y: 120, w: 20, h: 20 },
      { id: 's5', elementId: 'e5', x: 200, y: 480, w: 140, h: 80 },
    ],
  },
  object: {
    diagram: 'object',
    elements: [
      { id: 'e1', kind: 'object', name: 'курс : CourseOffering', slots: [{ vis: 'public', name: 'номер', default: '3101' }] },
      { id: 'e2', kind: 'object', name: 'студент : Student', slots: [{ vis: 'public', name: 'имя', default: '«Анна»' }] },
      { id: 'e3', kind: 'class', name: 'CourseOffering', attributes: [{ vis: 'private', name: 'номер', type: 'long', isID: true }] },
    ],
    relationships: [
      { id: 'r1', kind: 'link', from: 'e2', to: 'e1', name: '1' },
      { id: 'r2', kind: 'dependency', from: 'e1', to: 'e3' },
    ],
    shapes: [
      { id: 's1', elementId: 'e1', x: 200, y: 60, w: 190, h: 90 },
      { id: 's2', elementId: 'e2', x: 200, y: 220, w: 190, h: 90 },
      { id: 's3', elementId: 'e3', x: 480, y: 60, w: 190, h: 170 },
    ],
  },
  profile: {
    diagram: 'profile',
    elements: [
      { id: 'e1', kind: 'profile', name: 'Профиль разработки' },
      { id: 'e2', kind: 'stereotype', name: 'entity', stereotype: 'stereotype' },
      { id: 'e3', kind: 'metaclass', name: 'Class', stereotype: 'metaclass' },
    ],
    relationships: [{ id: 'r1', kind: 'extension', from: 'e2', to: 'e3' }],
    shapes: [
      { id: 's1', elementId: 'e1', x: 60, y: 60, w: 520, h: 300 },
      { id: 's2', elementId: 'e2', x: 120, y: 120, w: 160, h: 90 },
      { id: 's3', elementId: 'e3', x: 340, y: 120, w: 160, h: 90 },
    ],
  },
  communication: {
    diagram: 'communication',
    elements: [
      { id: 'e1', kind: 'object', name: 'студент : Student' },
      { id: 'e2', kind: 'object', name: 'контроллер : Registrar' },
      { id: 'e3', kind: 'lifeline', name: 'не участвует' },
    ],
    relationships: [
      { id: 'r1', kind: 'link', from: 'e1', to: 'e2', name: '1: зарегистрировать()' },
      { id: 'r2', kind: 'message', from: 'e2', to: 'e1', name: '2: подтвердить()' },
    ],
    shapes: [
      { id: 's1', elementId: 'e1', x: 160, y: 60, w: 160, h: 80 },
      { id: 's2', elementId: 'e2', x: 160, y: 260, w: 190, h: 80 },
    ],
  },
  timing: {
    diagram: 'timing',
    elements: [
      { id: 'e1', kind: 'timingLane', name: 'CourseOffering', timeline: [{ state: 'Open', from: 0, to: 40 }, { state: 'Closed', from: 40, to: 100 }] },
      { id: 'e2', kind: 'lifeline', name: 'Регистратор' },
    ],
    relationships: [],
    shapes: [
      { id: 's1', elementId: 'e1', x: 100, y: 80, w: 420, h: 80 },
      { id: 's2', elementId: 'e2', x: 100, y: 220, w: 120, h: 200 },
    ],
  },
  'interaction-overview': {
    diagram: 'interaction-overview',
    elements: [
      { id: 'e1', kind: 'interaction', name: 'Авторизация' },
      { id: 'e2', kind: 'interaction', name: 'Регистрация' },
      { id: 'e3', kind: 'lifeline', name: 'Пользователь' },
      { id: 'e4', kind: 'lifeline', name: 'Система' },
    ],
    relationships: [{ id: 'r1', kind: 'message', from: 'e3', to: 'e4', name: 'войти()' }],
    shapes: [
      { id: 's1', elementId: 'e3', x: 120, y: 60, w: 120, h: 260 },
      { id: 's2', elementId: 'e4', x: 320, y: 60, w: 120, h: 260 },
      { id: 's3', elementId: 'e1', x: 100, y: 100, w: 360, h: 80 },
      { id: 's4', elementId: 'e2', x: 100, y: 220, w: 360, h: 80 },
    ],
    links: [{ id: 'l1', relId: 'r1', from: { shapeId: 's1' }, to: { shapeId: 's2' }, y: 160 }],
  },
};
