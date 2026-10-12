import type { Page } from 'playwright-core'

// The outline and the views live in tabs of the panel that floats inside the viewport. The
// scenarios do not: they are chosen from the bar under the picture, which also holds the player and
// opens the list of steps. These helpers reach what a test wants.
// `scope` is a CSS prefix for a page with several diagrams, or several levels of one.

const literal = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

async function show(page: Page, scope: string, name: string) {
  // A panel folded to its button has no tabs: open it first.
  const folded = page.locator(`${scope} [aria-label="Show the panel"]`)
  if (await folded.count()) await folded.first().click()
  const tab = page.locator(`${scope} .idocs-panel-tab`).filter({ hasText: name }).first()
  if ((await tab.getAttribute('aria-selected')) !== 'true') await tab.click()
}

/** The card of a view with exactly this title, or else the first whose title contains it. */
async function card(page: Page, scope: string, title: string) {
  const titled = (match: string | RegExp) =>
    page
      .locator(`${scope} .idocs-scn`)
      .filter({ has: page.locator('.idocs-scn-title', { hasText: match }) })
  const exact = titled(new RegExp(`^${literal(title)}$`))
  return ((await exact.count()) ? exact : titled(title)).first()
}

/** Open the menu of scenarios on the bar, if it is not open. */
async function menu(page: Page, scope: string) {
  if (!(await page.locator(`${scope} .idocs-sel-item`).count())) {
    await page.locator(`${scope} .idocs-sel-btn`).first().click()
  }
  await page.locator(`${scope} .idocs-sel-item`).first().waitFor()
}

/** Put the menu away again, as a reader would. */
const closeMenu = (page: Page) => page.keyboard.press('Escape')

/** Choose a scenario by its title ("Overview" for none), or else the first whose title contains it. */
export async function pick(page: Page, title: string, scope = '') {
  await menu(page, scope)
  const titled = (match: string | RegExp) =>
    page
      .locator(`${scope} .idocs-sel-item`)
      .filter({ has: page.locator('.idocs-sel-title', { hasText: match }) })
  const exact = titled(new RegExp(`^${literal(title)}$`))
  await ((await exact.count()) ? exact : titled(title)).first().click()
}

/** Choose a view by its title. */
export async function pickView(page: Page, title: string, scope = '') {
  await show(page, scope, 'Views')
  await (await card(page, scope, title)).click()
}

/** The titles of the scenarios on offer, "Overview" first. */
export async function scenarioTitles(page: Page, scope = '') {
  await menu(page, scope)
  const titles = await page.locator(`${scope} .idocs-sel-item .idocs-sel-title`).allTextContents()
  await closeMenu(page)
  return titles
}

/** The title of the scenario that is chosen. */
export async function chosen(page: Page, scope = '') {
  await menu(page, scope)
  const title = await page
    .locator(`${scope} .idocs-sel-item[aria-checked="true"] .idocs-sel-title`)
    .first()
    .textContent()
  await closeMenu(page)
  return title
}

/** Open the list of steps above the bar, if it is not open. */
export async function openSteps(page: Page, scope = '') {
  if (!(await page.locator(`${scope} .idocs-steps-pop`).count())) {
    await page.locator(`${scope} .idocs-steps-btn`).first().click()
  }
  await page.locator(`${scope} .idocs-steps-pop`).waitFor()
}

/** The number of the step in progress, as the bar says it, or null before the scenario starts. */
export async function stepNow(page: Page, scope = '') {
  const text = await page.locator(`${scope} .idocs-time`).first().textContent()
  const at = /step (\d+)\//.exec(text ?? '')
  return at ? Number(at[1]) : null
}

/** Wait until the scenario has started, so the bar names a step. */
export async function waitForStep(page: Page, scope = '') {
  await page.waitForFunction(
    (prefix) =>
      /step \d+\//.test(document.querySelector(`${prefix} .idocs-time`)?.textContent ?? ''),
    scope,
  )
}

/** Fold the list of steps away again, so it is not in the way of the picture. */
export async function closeSteps(page: Page, scope = '') {
  if (await page.locator(`${scope} .idocs-steps-pop`).count()) {
    await page.locator(`${scope} .idocs-steps-btn`).first().click()
  }
  await page.locator(`${scope} .idocs-steps-pop`).waitFor({ state: 'detached' })
}
