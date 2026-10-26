import { remainingPercentage } from './limits';
it('shows remaining capacity from 100 to zero and subtracts reservations through native available', () => {
  expect(remainingPercentage({ limit: '100', available: '100' })).toBe(100);
  expect(remainingPercentage({ limit: '100', available: '70' })).toBe(70);
  expect(remainingPercentage({ limit: '100', available: '0' })).toBe(0);
  expect(remainingPercentage({ limit: '100', available: '-1' })).toBe(0);
  expect(remainingPercentage({ limit: '0', available: '0' })).toBe(0);
});
