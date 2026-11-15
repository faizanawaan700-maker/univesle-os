const { chromium } = require('playwright');

(async () => {
  const b = await chromium.launch({ headless: false });
  const c = await b.newContext({ baseURL: 'http://127.0.0.1:3000' });
  const p = await c.newPage();

  console.log('=== UBOS Authentication Verification ===\n');

  // Step 1: Go to the app
  console.log('Step 1: Loading app...');
  await p.goto('/');
  console.log('Title:', await p.title());

  // Step 2: Fill the form
  console.log('\nStep 2: Filling registration form...');
  await p.getByLabel('Your name').fill('Test User');
  await p.getByLabel('Business or organization').fill('Test Org');
  await p.getByLabel('Work email').fill('test@example.com');
  await p.getByLabel('Password').fill('e2e-browser-test-password');

  // Step 3: Click the button (should work now with pointer-events: none)
  console.log('\nStep 3: Clicking Create workspace...');
  await p.getByRole('button', { name: /Create workspace/i }).click({ timeout: 5000 });
  await p.waitForLoadState('networkidle');

  // Step 4: Check /auth/me
  console.log('\nStep 4: Verifying /auth/me endpoint...');
  const me = await p.evaluate(() => 
    fetch('http://127.0.0.1:4000/auth/me', { credentials: 'include' })
      .then(r => [r.status, r.text()]
  );
  console.log('/auth/me status:', me[0]);
  console.log('/auth/me body:', me[1].substring(0, 200));

  if (me[0] === 200) {
    console.log('\n✓ SUCCESS: Authentication is working!');
  } else {
    console.log('\n✗ FAILURE: Authentication returned status', me[0]);
  }

  // Step 5: Test logout
  console.log('\nStep 5: Testing logout...');
  const logout = await p.evaluate(() => 
    fetch('http://127.0.0.1:4000/auth/logout', { method: 'POST', credentials: 'include' })
      .then(r => r.status)
  );
  console.log('/auth/logout status:', logout);

  console.log('\n=== Verification Complete ===');
  await b.close();
})().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});