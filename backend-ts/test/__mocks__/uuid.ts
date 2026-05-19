// UUID Mock for Jest
export const v4 = jest.fn(() => 'mock-uuid-' + Math.random().toString(36).substr(2, 9));
export const v5 = jest.fn(() => 'mock-uuid-v5');
export const NIL = '00000000-0000-0000-0000-000000000000';
export const parse = jest.fn();
export const stringify = jest.fn();
export const validate = jest.fn(() => true);
export const version = jest.fn(() => 4);
