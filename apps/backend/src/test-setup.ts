import { resetSseLimitsForTesting } from './shared/security/sse-limits';

afterEach(() => {
  resetSseLimitsForTesting();
});
