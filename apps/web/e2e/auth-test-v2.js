/** UBOS browser E2E - Authentication verification script */
const { chromium } = require('playwright');
const { expect } = require('@playwright/test');

(async () => {
  // Launch browser
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    baseURL: 'http://127.0.0.1:3000',
  });
  const page = await context.newPage();

  // Go to the app
  await page.goto('/');

  // Check that the registration form is visible
  console.log('Checking registration form...');
  await expect(page.getByLabel('Your name')).toBeVisible();
  await expect(page.getByLabel('Business or organization')).toBeVisible();
  await expect(page.getByLabel('Work email')).toBeVisible();
  await expect(page.getByLabel('Password')).toBeVisible();
  await expect(page.getByRole('button', { name: /Create workspace/i })).toBeVisible();
  console.log('Registration form is visible');

  // Register a test workspace - scroll button into view and click
  console.log('Registering test workspace...');
  const createBtn = page.getByRole('button', { name: /Create workspace/i });
  await page.evaluate((btn) => btn.scrollIntoView({ behavior: 'smooth', block: 'center' }), createBtn);
  await createBtn.click({ timeout: 5000 });

  // Wait for success or error
  const url = page.url();
  console.log('Current URL after click:', url);

  // Check for success message
  try {
    await expect(page.getByRole('heading', { name: /Good to have you here/i })).toBeVisible({ timeout: 15000 });
    console.log('Registration successful!');
  } catch (e) {
    // Check for error message
    const error = await page.locator('.alert-error, .alert-danger, text=/Error|Failed|Invalid/i).first();
    const errorText = await error.textContent();
    console.log('Registration error:', errorText);
    
    // Try again with a different approach - wait and retry
    await page.waitForTimeout(2000);
    await createBtn.click({ timeout: 5000 });
    await expect(page.getByRole('heading', { name: /Good to have you here/i })).toBeVisible({ timeout: 15000 });
    console.log('Registration successful on retry!');
  }

  // Verify /auth/me works with cookies
  console.log('Verifying /auth/me endpoint...');
  const me = await page.evaluate(async () => {
    const r = await fetch('http://127.0.0.1:4000/auth/me', { credentials: 'include' });
    return { status: r.status, body: await r.text() };
  });

  console.log(`/auth/me status: ${me.status}`);
  console.log(`/auth/me body: ${me.body.substring(0, 200)}`);

  if (me.status === 200) {
    console.log('SUCCESS: Authentication is working!');
  } else {
    console.log('FAILURE: Authentication returned status', me.status);
  }

  // Test invalid credentials handling
  console.log('\nTesting invalid credentials...');
  await page.goto('/');
  await page.getByLabel('Your name').fill('Test User');
  await page.getByLabel('Business or organization').fill('Test Org');
  await page.getByLabel('Work email').fill('invalid@example.com');
  await page.getByLabel('Password').fill('short');
  const createBtn2 = page.getByRole('button', { name: /Create workspace/i });
  await page.evaluate((btn) => btn.scrollIntoView({ behavior: 'smooth', block: 'center' }), createBtn2);
  await createBtn2.click({ timeout: 5000 });
  await page.waitForTimeout(3000);
  console.log('Invalid credentials test completed - page still running');

  // Test logout
  console.log('\nTesting logout...');
  const logout = await page.evaluate(async () => {
    const r = await fetch('http://127.0.0.1:4000/auth/logout', { method: 'POST', credentials: 'include' });
    return r.status;
  });
  console.log(`/auth/logout status: ${logout}`);

  // Close browser
  await browser.close();
  console.log('\nAuthentication verification completed!');
})().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});