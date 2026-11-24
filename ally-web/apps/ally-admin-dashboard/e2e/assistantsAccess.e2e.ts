import { expect, test, type Page, type Route } from "@playwright/test";

import { BOT_ID, mockAssistantHome } from "./assistantHome.fixture";

/**
 * A1 smoke, at 1440 only: logged out → a deep link → the login screen (no sign-up) → back on the
 * deep link; and a custom login whose only feature is Chatbots lands on its assistants with no
 * Sidebar, only its email and Log out (6b, item 31). The API is mocked; no backend is needed.
 */
test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, "A1's smoke runs at 1440 only");

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

async function mockLogin(page: Page, features: string[]) {
  // Registered after mockAssistantHome's catch-all, so these win.
  await page.route("**/api/v2/auth/generate-otp", r => json(r, { message: "Code sent" }));
  await page.route("**/api/v2/auth/verify-otp", r =>
    json(r, { accessToken: "a1-token", refreshToken: "a1-refresh" }),
  );
  await page.route("**/api/v1/users/me", r =>
    json(r, {
      id: 7,
      userId: 7,
      email: "asha@clinic.example",
      name: "Asha Rao",
      role: "PLATFORM_ADMIN",
      roles: ["PLATFORM_ADMIN"],
    }),
  );
  await page.route("**/api/v1/users/me/preferences", r => json(r, {}));
  await page.route("**/api/v1/users/me/feature-toggles", r => json(r, features));
  await page.route("**/api/v1/authorization/permissions", r =>
    json(r, ["system:access", "view:whatsapp-bot", "edit:whatsapp-bot", "view:users"]),
  );
}

// The standard login's button is "Next"; the assistants login's is "Send code".
const SEND_CODE = { name: /^(Next|Send code)$/ };

async function logIn(page: Page) {
  await page.getByPlaceholder("Enter your email address").fill("asha@clinic.example");
  await page.getByRole("button", SEND_CODE).click();
  const digits = page.locator('input[inputmode="numeric"]');
  await expect(digits.first()).toBeVisible();
  const count = await digits.count();
  for (let i = 0; i < count; i++) await digits.nth(i).fill(String((i % 9) + 1));
  // The last digit verifies on its own (master's 04f3c2f8b), so there's no Verify to press.
  // Logged in once the login screen is gone (it may be drawn at /login or at the page they opened).
  await expect(digits.first()).toBeHidden();
}

test("logged out: a deep link shows the login screen at that URL (no sign-up), and stays there after login", async ({
  page,
}) => {
  await mockAssistantHome(page);
  await mockLogin(page, ["whatsapp_bot"]);
  const deepLink = `/assistants/${BOT_ID}?section=lists&tool=memory`;

  await page.goto(deepLink);
  // The login screen is drawn at the URL they opened: no redirect to /login.
  await expect(page.getByRole("button", { name: "Send code" })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/assistants/${BOT_ID}\\?section=lists&tool=memory$`));
  await expect(page.getByText(/sign\s*up/i)).toHaveCount(0);

  await logIn(page);
  await expect(page).toHaveURL(new RegExp(`/assistants/${BOT_ID}\\?section=lists&tool=memory$`));
  // Assistants is all it has, so it sees the assistant alone (6b, item 31).
  await expect(page.getByTestId("assistant-only-header")).toBeVisible();
  await expect(page.getByTestId("admin-sidebar")).toHaveCount(0);
});

test("sign-up links go to the login screen", async ({ page }) => {
  await page.goto("/signup");
  await expect(page).toHaveURL(/\/login$/);
});

test("a Chatbots-only custom login lands on its assistants and sees nothing else", async ({
  page,
}) => {
  await mockAssistantHome(page);
  await mockLogin(page, ["whatsapp_bot"]);
  await page.goto("/login");
  await logIn(page);
  // Its one assistant, with no right to create another, opens straight (stage 3).
  const itsAssistant = new RegExp(`/assistants/${BOT_ID}$`);
  await expect(page).toHaveURL(itsAssistant);
  // No Sidebar: only its email and Log out (6b, item 31).
  // One corner menu (stage 2): the email on its button, Plan and Log out inside it.
  await expect(page.getByTestId("assistant-only-header")).toContainText("asha@clinic.example");
  await page.getByTestId("corner-menu-button").click();
  await expect(page.getByTestId("assistant-only-logout")).toBeVisible();
  await expect(page.getByTestId("admin-sidebar")).toHaveCount(0);

  // Ally admin's pages aren't there for it: they lead back to its assistants.
  await page.goto("/user-management");
  await expect(page).toHaveURL(itsAssistant);
});

test("an old /chatbots link opens the same assistant under /assistants", async ({ page }) => {
  await mockAssistantHome(page);
  await mockLogin(page, ["whatsapp_bot"]);
  await page.goto("/login");
  await logIn(page);
  await page.goto(`/chatbots/${BOT_ID}?section=share`);
  await expect(page).toHaveURL(new RegExp(`/assistants/${BOT_ID}\\?section=share$`));
});

test("someone not on an assistant's team is told so, with the way back", async ({ page }) => {
  await mockAssistantHome(page);
  await mockLogin(page, ["whatsapp_bot"]);
  const other = "00000000-0000-4000-8000-00000000dead";
  await page.route(`**/api/v1/chatbots/${other}**`, r =>
    json(r, { statusCode: 404, message: "Chatbot not found" }, 404),
  );
  await page.goto("/login");
  await logIn(page);
  await page.goto(`/assistants/${other}`);
  await expect(page.getByTestId("assistant-no-access")).toContainText(
    "You don't have access to this assistant. Ask its owner to add you.",
  );
  await page.getByRole("link", { name: "Go to your assistants" }).click();
  await expect(page).toHaveURL(/\/assistants$/);
});
