const { chromium } = require('playwright');

(async () => {
  const b = await chromium.launch({ headless: false });
  const c = await b.newContext({ baseURL: 'http://127.0.0.1:3000' });
  const p = await c.newPage();
  
  console.log('=== Test 1: Check registration form ===');
  await p.goto('/');
  await p.getByLabel('Your name').fill('Test User');
  await p.getByLabel('Business or organization').fill('Test Org');
  await p.getByLabel('Work email').fill('test-' + Date.now() + '@example.com');
  await p.getByLabel('Password').fill('e2e-browser-test-password');
  
  console.log('=== Test 2: Click create workspace ===');
  await p.getByRole('button', { name: /Create workspace/i }).click({ timeout: 5000 });
  await p.waitForLoadState('networkidle');
  
  console.log('=== Test 3: Verify /auth/me ===');
  const me = await p.evaluate(() => 
    fetch('http://127.0.0.1:4000/auth/me', { credentials: 'include' })
      .then(r => [r.status, r.text()])
  );
  console.log('/auth/me status:', me[0]);
  console.log('/auth/me body:', me[1].substring(0, 200));
  
  if (me[0] === 200) {
    console.log('SUCCESS: Authentication is working!');
  } else {
    console.log('FAILURE: Authentication returned status', me[0]);
  }
  
  await b.close();
})().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});