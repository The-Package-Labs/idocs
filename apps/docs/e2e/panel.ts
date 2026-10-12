import type { Page } from 'playwright-core'

// The outline, the scenarios, the timeline and the views live in tabs of the panel that floats
// inside the viewport, and picking a scenario moves to its timeline. These helpers open the tab
// that has what a test wants.
// `scope` is a CSS prefix for a page with several diagrams, or several levels of one.

const literal = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

async function show(page: Page, scope: string, name: string) {
  // A panel folded to its pill has no tabs: open it first.
  const folded = page.locator(`${scope} [aria-label="Show the panel"]`)
  if (await folded.count()) await folded.first().click()
  const tab = page.locator(`${scope} .idocs-panel-tab`).filter({ hasText: name }).first()
  if ((await tab.getAttribute('aria-selected')) !== 'true') await tab.click()
}

/** The card with exactly this title, or else the first whose title contains it. */
async function card(page: Page, scope: string, title: string) {
  const titled = (match: string | RegExp) =>
    page
      .locator(`${scope} .idocs-scn`)
      .filter({ has: page.locator('.idocs-scn-title', { hasText: match }) })
  const exact = titled(new RegExp(`^${literal(title)}$`))
  return ((await exact.count()) ? exact : titled(title)).first()
}

/** Choose a scenario by its title, whichever tab the panel is on. */
export async function pick(page: Page, title: string, scope = '') {
  await show(page, scope, 'Scenarios')
  await (await card(page, scope, title)).click()
}

/** Choose a view by its title. */
export async function pickView(page: Page, title: string, scope = '') {
  await show(page, scope, 'Views')
  await (await card(page, scope, title)).click()
}

/** The titles of the scenarios on offer, "Overview" first. */
export async function scenarioTitles(page: Page, scope = '') {
  await show(page, scope, 'Scenarios')
  return page.locator(`${scope} .idocs-scn .idocs-scn-title`).allTextContents()
}

/** The title of the scenario that is chosen. */
export async function chosen(page: Page, scope = '') {
  await show(page, scope, 'Scenarios')
  return page
    .locator(`${scope} .idocs-scn[aria-pressed="true"] .idocs-scn-title`)
    .first()
    .textContent()
}
