import { expect, test } from '@playwright/test';

test('login with seeded admin reaches the dashboard', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill('admin@demo.local');
  await page.getByLabel('Password').fill('Admin123!');
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible({ timeout: 15_000 });
});

test('wrong password shows a safe error', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill('admin@demo.local');
  await page.getByLabel('Password').fill('wrong-password');
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page.getByText(/sign in failed|invalid|locked/i).first()).toBeVisible();
});
