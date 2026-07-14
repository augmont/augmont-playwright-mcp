# LGD Portal — AI Test-Case Generation & MCP Validation Guide

> **Purpose:** This is a self-contained reference of every button click, form, navigation flow, selector, API call, and expected outcome in the LGD Portal (Angular 20 + PrimeNG). It is designed to be:
> 1. **Fed as context/prompt to an AI model** when generating test cases (copy the relevant page section + the prompt template at the bottom).
> 2. **Auto-picked-up by an MCP browser-testing agent** (Playwright MCP / Chrome DevTools MCP) during test validation — the "Selector" columns tell the agent exactly what to target, and the "Action/Result" columns tell it what to assert.
>
> Generated from source on 2026-07-13 (branch `dev/country-add`). Regenerate when major UI flows change.

---

## 1. Application Overview

| Item | Value |
|---|---|
| Framework | Angular 20 (standalone components, signals), PrimeNG 20, Tailwind 4, Phosphor icons (`ph-*`), PrimeIcons (`pi-*`) |
| Start locally | `npm start` (ng serve) → `http://localhost:4200` |
| Local API | `http://localhost:3000/api/v1/` (`src/environments/environment.ts`) |
| Test env API | `https://api.testlgd.augmont.com/api/v1/` |
| UAT env API | `https://api.uatlgd.augmont.com/api/v1/` |
| Prod API | `https://diamonds-api.augmont.com/api/v1/` |
| Roles | `buyer` (main storefront), `seller`, admin/internal (any role not buyer/seller; CASL permission-gated) |
| Auth storage | localStorage: `token`, `user`, `userRole`, `permissions`, `userTypeId`, `kycVerified`, `lgd_cart`, `selectedCurrency`, `savedFilters`, `savedFiltersMelee`, `productSortOption`, `rememberedEmail` |
| Session start | POST `auth/user-login` → token stored → role-based redirect (`/buyer`, `/seller`, `/admin`) |
| Session end / 401 | Storage cleared → redirect `/login` |
| Feedback UX | PrimeNG toasts (`p-toast`), 3000 ms auto-dismiss; confirmation via `app-confirmation-dialog` / `p-dialog` / `p-confirmpopup` |

## 2. Selector Strategy for MCP / Playwright (IMPORTANT)

**The project has NO `data-testid` attributes.** Tests must locate elements in this priority order:

1. **Visible text / accessible role** — `getByRole('button', { name: 'Log In' })`, `getByText('Apply & Find Diamonds')`. Most reliable here; button labels are listed in every table below.
2. **Stable `id`s** — only ~146 ids exist; the useful ones are listed per page (e.g. `#mobileNumber`, `#email`, `#firstName`, `#saveFilterButton`, `#fileInput`, `#return-qc-fail-reason`, `#cartButton`).
3. **`formControlName` attributes** — every reactive-form field is targetable as `[formControlName="password"]`, `[formControlName="search"]` etc. These are the most stable hooks for inputs.
4. **Component CSS classes** — semantic classes documented below (`.topbar-menu-btn`, `.cart-trigger`, `.wishlist-trigger`, `.filter-btn`, `.filter-toggle-btn`, `.filter-main-tab`, `.cart-step`, `.address-card`, `.saved-search-btn` …).
5. **PrimeNG component tags** — `p-select`, `p-checkbox`, `p-toggleswitch`, `p-inputotp`, `p-dialog`, `p-drawer`, `p-paginator`, `p-datepicker`, `p-multiselect`. PrimeNG renders overlays (`p-select` panels, dialogs, popovers) **appended to `<body>`**, so query overlay options globally, not inside the trigger element.
6. **Icon classes** — Phosphor (`i.ph-heart`, `i.ph-shopping-bag`, `i.ph-copy`, `i.ph-trash`, `i.ph-pencil-simple`) and PrimeIcons (`i.pi-times`, `i.pi-check`, `i.pi-ellipsis-v`) identify icon-only buttons.

**Assertion sources:** URL changes (routes below), toast text (`.p-toast .p-toast-detail`), dialog visibility, table row counts, localStorage keys, and outbound API calls (paths documented per flow — mock or observe via network).

**Recommendation (gap):** adding `data-testid` attributes would make selectors durable; until then, treat button-label changes as test-breaking changes.

## 3. Test Login & Role Setup

- UI login: go to `/login`, fill `#mobileNumber` (email/mobile) + `app-password input`, click **Log In** → POST `auth/user-login` → role redirect.
- Programmatic session (faster for MCP runs): seed localStorage `token`, `userRole` (`buyer`|`seller`|admin role name), `user`, `permissions`, then navigate to the target route (the `authGuard` only checks `token` + `userRole` presence and role match).
- Admin buttons render only when CASL `ability.can(action, subject)` passes — permissions come from the `permissions` localStorage payload set at login. A missing button usually means missing permission, not a bug.

---

# SECTION: Routing & Layout Navigation Reference

## 1. Route Table

Entry point: `src/app/routes/app.routes.ts` merges `publicRoutes`, `buyerRoutes`, `sellerRoutes`, `adminRoutes`, plus a wildcard fallback.

```
routes = [ ...publicRoutes, ...buyerRoutes, ...sellerRoutes, ...adminRoutes, { path: '**', redirectTo: '' } ]
```

Every route resolves `layout` via `setLayout(...)` (`src/app/services/resolver/layout.resolver.ts`) which sets the active `PageLayout` (Public or Authorized) in `LayoutService`.

### 1a. Public routes — `src/app/routes/public.routes.ts`
Layout: `PageLayout.Public`. No guards. No role restriction.

| URL Path | Component (lazy) | Guard | Resolver | Notes |
|---|---|---|---|---|
| `` (root) | HomeComponent (`pages/public/home`) | none | setLayout(Public) | Nested child of `''` |
| `download-app` | DownloadAppComponent | none | setLayout(Public) | |
| `login` | LoginComponent | none | setLayout(Public) | |
| `register` | SignUpComponent | none | — | Parent with children |
| `register` (child `''`) | SignUpFormComponent | none | setLayout(Public) | |
| `register/verify` | VerifyComponent (sign-up) | none | setLayout(Public) | |
| `register/company-details` | CompanyDetailsComponent | none | setLayout(Public) | |
| `register/success` | SuccessComponent (sign-up) | none | setLayout(Public) | |
| `forgot-password` | ForgotPasswordComponent | none | setLayout(Public) | Parent with children |
| `forgot-password` (child `''`) | ForgotPasswordFormComponent | none | — | |
| `forgot-password/verify` | VerifyComponent (forgot-pw) | none | — | |
| `forgot-password/reset` | ResetPasswordFormComponent | none | — | |
| `forgot-password/update-password` | UpdatePasswordComponent | none | — | |
| `forgot-password/success` | SuccessComponent (forgot-pw) | none | — | |
| `about-us` | AboutUsComponent | none | setLayout(Public) | |
| `contact-us` | ContactUsComponent | none | setLayout(Public) | |
| `terms-and-conditions` | TermsAndConditionsComponent | none | setLayout(Public) | |
| `return-policy` | ReturnPolicyComponent | none | setLayout(Public) | |
| `disclaimer` | DisclaimerComponent | none | setLayout(Public) | |
| `privacy-policy` | PrivacyPolicyComponent | none | setLayout(Public) | |
| `news-insights` | BlogComponent | none | setLayout(Public) | |
| `news-insights-details/:slug/:id` | BlogDetailsComponent | none | setLayout(Public) | |
| `bookademo` | BookADemoComponent | none | setLayout(Public) | |
| `demo/reschedule` | DemoRescheduleComponent | none | setLayout(Public) | |
| `demo/cancel` | DemoCancelComponent | none | setLayout(Public) | |

### 1b. Buyer routes — `src/app/routes/buyer.routes.ts`
Parent `path: 'buyer'`, `component: AuthorizedComponent`, `canActivate: [authGuard]`, `data: { roles: 'buyer' }`, `resolve: layout = setLayout(Authorized)`. All children inherit guard + role restriction (role `buyer`).

| URL Path | Component (lazy) | data |
|---|---|---|
| `buyer` | HomeComponent (`pages/buyer/home`) | |
| `buyer/products` | ProductsComponent | |
| `buyer/products/melee` | MeleeProductsComponent | `{ productLine: 'melee' }` |
| `buyer/products/:productId` | ProductDetailComponent | |
| `buyer/video` | MediaComponent (`core/components/media`) | |
| `buyer/cart` | CartComponent | |
| `buyer/orders` | OrdersComponent | |
| `buyer/orders/:id` | OrderDetailComponent | |
| `buyer/payment/success` | PaymentResultComponent | `{ type: 'success' }` |
| `buyer/payment/failure` | PaymentResultComponent | `{ type: 'failed' }` |
| `buyer/payment/cancel` | PaymentResultComponent | `{ type: 'cancel' }` |
| `buyer/wishlist` | WishlistComponent | |
| `buyer/order-success` | OrderSuccessComponent | |
| `buyer/match-pair/:productId` | MatchingPairComponent | |
| `buyer/theme-demo` | ThemeDemoComponent | |
| `buyer/share-stone/:id` | ShareStoneComponent | |
| `buyer/resource` | ResourceComponent | Parent; child `''` redirects to `overview` (pathMatch full) |
| `buyer/resource/overview` | OverviewComponent | |
| `buyer/resource/setup` | SetupComponent | |
| `buyer/resource/markups` | MarkupsComponent | |
| `buyer/resource/shopify-guide` | ShopifyGuideComponent | |
| `buyer/resource/installation-guide` | InstallationGuideComponent | |
| `buyer/resource/faq` | FaqComponent (api-exposure) | |
| `buyer/buyback` | BuybackComponent | |
| `buyer/my-account` | MyAccountComponent | Parent; child `''` = PersonalSettingComponent |
| `buyer/my-account/currency` | ChangeCurrencyComponent | |
| `buyer/my-account/password` | ChangePasswordComponent | |
| `buyer/my-account/address` | AddressComponent | Parent; child `''` = AdressListComponent |
| `buyer/my-account/address/add` | AddAddressComponent | |
| `buyer/my-account/address/update/:id` | AddAddressComponent | |
| `buyer/my-account/delete` | DeleteAccountComponent | |
| `buyer/my-account/logout` | LogoutComponent | |
| `buyer/requests` | RequestsComponent | |
| `buyer/requests/:id` | ViewRequestComponent | |
| `buyer/terms-and-conditions` | TermsAndConditionsComponent (public reuse) | |
| `buyer/privacy-policy` | PrivacyPolicyComponent (public reuse) | |
| `buyer/return-policy` | ReturnPolicyComponent (public reuse) | |
| `buyer/faq` | BuyerFaqComponent | |
| `buyer/contact-us` | ContactUsComponent (public reuse) | |

### 1c. Seller routes — `src/app/routes/seller.routes.ts`
Parent `path: 'seller'`, `component: AuthorizedComponent`, `canActivate: [authGuard]`, `data: { roles: ['seller'] }`, `resolve: layout = setLayout(Authorized)`. Role restriction: `seller`.

| URL Path | Component (lazy) |
|---|---|
| `seller` | HomeComponent (reuses `pages/buyer/home`) |

### 1d. Admin routes — `src/app/routes/admin.routes.ts`
Parent `path: 'admin'`, `component: AuthorizedComponent`, `canActivate: [authGuard]`, `data: { excludeRoles: ['buyer', 'seller'] }`, `resolve: layout = setLayout(Authorized)`. Restriction: any authenticated user whose role is NOT `buyer`/`seller` (i.e. admin/internal roles). Per-item visibility is further gated by CASL abilities in the sidebar (see §3e), but routes themselves only enforce `excludeRoles`.

| URL Path | Component (lazy) |
|---|---|
| `admin` | HomeComponent (`pages/admin/home`) |
| `admin/buyers` | BuyersComponent |
| `admin/sellers` | SellersComponent |
| `admin/orders` | OrdersComponent |
| `admin/buy-back-requests` | BuyBackRequestsComponent |
| `admin/requests` | RequestComponent |
| `admin/orders/:id` | OrderDetailComponent |
| `admin/orders/:id/stone-recommendation` | StoneRecommendationDialogComponent |
| `admin/unapproved-products` | AdminUnapprovedProductsComponent |
| `admin/all-products` | AdminAllProductsComponent |
| `admin/contact-us-queries` | ContactUsQueriesComponent |
| `admin/user-type-master` | UserTypeMasterComponent |
| `admin/internal-users` | InternalUsersComponent |
| `admin/roles` | RoleAndPermissionComponent |
| `admin/permission/:roleId` | AddPermissionComponent |
| `admin/sellers/bulk-update-margin` | BulkUpdateMarginComponent |
| `admin/sellers/create-seller` | OnboardSellerComponent |
| `admin/sellers/update-seller/:id` | OnboardSellerComponent |
| `admin/book-a-demo` | AdminBookDemoComponent |

### 1e. Fallback
| URL Path | Behavior |
|---|---|
| `**` | `redirectTo: ''` (home) |

---

## 2. Guards — `src/app/services/guards`

### `auth.guard.ts` — `authGuard` (CanActivateFn)
Injects `AuthService`, `Router`, `LayoutService`.

| Check | Result |
|---|---|
| `!authService.isAuthenticated()` | Sets `PageLayout.Public`; returns `router.parseUrl('/login')` (redirect to **/login**). `isAuthenticated()` = both `token` and `userRole` present in local store. |
| Authenticated | Sets `PageLayout.Authorized`, reads `userRole = authService.getRole()`. |
| `route.data['excludeRoles']` includes userRole | Redirects: buyer → `/buyer`, seller → `/seller`, else `/` |
| `route.data['roles']` present and includes userRole | Returns `true` (allow) |
| `route.data['roles']` present but userRole not included | Redirects to **/unauthorized** (note: no `/unauthorized` route is defined → falls through to `**` → home) |
| No role data | Returns `true` |

### `public.guard.ts` — `publicGuard` (CanActivateFn)
Injects `AuthService`, `Router`. NOTE: defined but not referenced in any route file (`app/public/buyer/seller/admin.routes.ts` do not attach it).

| Check | Result |
|---|---|
| `authService.isAuthenticated()` and role present | Redirects to `/{userRole}` (e.g. `/buyer`, `/admin`) |
| Otherwise | Returns `true` |

### Logout behavior (referenced by layouts) — `AuthService.logout()` (`services/common/auth.service.ts`)
`POST auth/logout` (header `X-Skip-Error: true`); on success OR error runs `completeLogout()`: resets InitializationService, clears role/ability, clears local storage keys (`token`, `user`, `permissions`, `lgd_cart`, `selectedCurrency`, `productSortOption`, `savedFilters`), clears `userService.filters`, removes body classes `blocked-scroll`/`p-overflow-hidden`, sets `PageLayout.Public`, then `router.navigate(['/login'], { state: { fromLogout: true } })`.

---

## 3. Layouts — clickable elements

### 3a. Authorized shell — `src/app/layouts/authorized/authorized.component.{html,ts}`
Container layout for buyer/seller/admin. No direct buttons; composes chrome + `<router-outlet>`. Renders: `<app-topbar>`, `<app-sub-topbar>` (hidden unless `showSubTopbar()`), `<app-cart-topbar>` (hidden unless `showCartTopbar()`), `<app-footer>` (hidden unless `showFooter()`), `<app-sidebar>` drawer.

| Behavior | Selector / hook | Logic |
|---|---|---|
| Sub-topbar visibility | `<app-sub-topbar [hidden]="!showSubTopbar()">` | Hidden on routes starting with `/buyer/cart`, `/buyer/terms-and-conditions`, `/buyer/privacy-policy`, `/buyer/return-policy`, `/buyer/faq`, `/buyer/contact-us` |
| Cart-topbar visibility | `<app-cart-topbar [hidden]="!showCartTopbar()">` | Shown only when path starts with `/buyer/cart` |
| Footer visibility | `<app-footer [hidden]="!showFooter()">` | Hidden on `/buyer/products` and `/buyer/products/melee` (list pages) |
| Content padding | `.layout-content-slot` `[class.px-6]` | Removed on LEGAL_CONTENT_ROUTES |
| Scroll container | `#scrollContainer`, `(scroll)="onScroll($event)"` | Emits scroll state to HelperService |
| Sidebar drawer | `<app-sidebar [showDrawer]="isMenuActive()" (onHide)="onHide()">` | `onHide()` sets `menuActive=false` |
| `backToCatalog()` (method, not bound in this HTML) | — | `router.navigate(['/buyer/products'])` |

### 3b. Topbar — `src/app/layouts/topbar/topbar.component.{html,ts}`
Root `.topbar` / `.topbar-inner`. Rendered for all authorized roles; cart/wishlist only when `isBuyer()` (role `buyer`).

| Element / label | Selector (class / attr) | Handler | Action / Result |
|---|---|---|---|
| Menu button ("Menu", `ph-list` icon) | `.topbar-menu-btn`, text "Menu", `.topbar-menu-text` | `(click)="toggleMenu()"` | Toggles sidebar drawer via `LayoutService.showMenu()/hideMenu()`; blocks/unblocks body scroll (`blocked-scroll`) |
| Logo | `img[alt="Augmont Logo"].cursor-pointer` (src `augmont-regular.svg`) | `(click)="routeToHome()"` | `router.navigate(['/buyer'])` |
| Currency selector | `p-select.currency-select`, panel `.currency-select-panel`, caret `.currency-caret` | `(onChange)="onCurrencyChange($event.value)"` | Sets `userService.currency`, emits `myAccountService.currencySubject`, saves `selectedCurrency` to local store. No navigation/API |
| Cart trigger (`ph-shopping-bag` + amount) | `button.cart-trigger`, `#cartButton`, `aria-label="Cart"`, `.cart-text` | `(click)="toggleCart($event)"` | Toggles `<app-cart-popover>` overlay anchored to cart button. Buyer only |
| Wishlist trigger (`ph-heart` + count) | `button.wishlist-trigger`, `aria-label="Wishlist"`, count in `.cart-text` (**not** `.badge`) | `(click)="routeToWishlist()"` | `router.navigate(['/buyer/wishlist'])`. Buyer only. After add-to-wishlist: assert filled card heart `app-product-card i.ph-fill.ph-heart` and/or `button.wishlist-trigger .cart-text` — never `.badge`. |
| User/Account | `button.user-trigger`, `aria-label="Account"`, `pTooltip` = full name, tooltip class `topbar-user-tooltip` | none (tooltip only) | Shows user's full name tooltip; no click action |
| Help ("Need Help") | `button.help-trigger`, `.help-text` | commented out in HTML | (Method `openNeedHelp()` opens `https://augmont.zohodesk.in/portal/en/newticket` in new tab — currently not wired) |
| Cart popover | `<app-cart-popover />` | — | Popover component toggled by cart trigger |

TS methods: `logout()` → `authService.logout()` (not bound in this template); `toggleDarkMode()`, `toggleSidenav()` (unused here).

### 3c. Sub-topbar — `src/app/layouts/sub-topbar/sub-topbar.component.{html,ts}`
Root `.layout-topbar` (aka `.topbar` styling). `[hidden]="!isBuyer()"` — visible only for role `buyer`. Iterates `navItems`.

| Element / label | Selector (class / text) | Handler / link | Action / Result |
|---|---|---|---|
| "Lab Grown Diamonds" | `a.link`, `routerLinkActive="link-active"`, exact=true | `[routerLink]="/buyer/products"` | Navigate to `/buyer/products` |
| "Lab Grown Melee" | `a.link`, exact=false | `[routerLink]="/buyer/products/melee"` | Navigate to `/buyer/products/melee` |
| "Natural Diamond" | `div` with `.bg-warning-light` "Coming Soon!" badge | none (comingSoon) | No navigation (disabled) |
| "Natural Melee" | `div` + "Coming Soon!" badge | none (comingSoon) | No navigation (disabled) |

`navItems` array is hardcoded in the TS.

### 3d. Cart-topbar — `src/app/layouts/cart-topbar/cart-topbar.component.{html,ts}`
Root `.cart-topbar`. Shown only on `/buyer/cart`. Injects `CartService`.

| Element / label | Selector (class / text) | Handler | Action / Result |
|---|---|---|---|
| Back ("Back", `ph-arrow-left`) | `button.cart-back-button` | `(click)="cartService.goBack()"` | Navigates back one cart step / to catalog (CartService logic) |
| Step "Your Cart" | `.cart-step`, `.cart-step-icon`/`.cart-step-label` (`.active` when `activeStep()==='0'`), `ph-shopping-bag` | none | Progress indicator (no click nav) |
| Step "Delivery Address" | `.cart-step` (`.pointer-events-none` when activeStep < '1'), `ph-map-pin` | none | Progress indicator |
| Step "Order Review" | `.cart-step` (`.pointer-events-none` when activeStep < '2'), `ph-clipboard` | none | Progress indicator |
| Connectors | `.cart-step-connector` (`.active` when activeStep ≥ threshold) | none | Visual only |

### 3e. Sidebar — `src/app/layouts/sidebar/sidebar.component.{html,ts}`
`p-drawer` (`position="left"`, width 320px, `styleClass="sidebar-drawer"`), `[(visible)]="showDrawer"`, `(onHide)` → emits `onHide`. Two branches: buyer vs non-buyer (admin/internal). Nav data comes from `SidebarPermissionService.getSidebarNavs(ability, userTypeId, role)`.

Common handlers (TS):
- `onBuyerNavClick(navItem)` → if `comingSoon` returns; else `setSelectedSampleAppsSidebarNav(navItem.title)`.
- `setSelectedSampleAppsSidebarNav(title)` → if title `'Logout'`/`'Log Out'` calls `logout()`; else sets active, closes drawer (`showDrawer=false`, emits onHide).
- `logout()` → closes drawer, emits onHide, `authService.logout()` (see §2 logout).
- `closeSidebar()` → closes drawer, emits onHide, `layoutService.hideMenu()`.
- `toggleSubmenu(title)` → expand/collapse submenu.

**Buyer branch** (`isBuyer()` true). Each item: `div.group` with `(click)="onBuyerNavClick(navItem)"`, `(keyup)`, `[routerLink]="!comingSoon ? navItem.routerLink : null"`, `tabindex="0"`; active class `bg-mixed-tinge border-l-4 border-primary`; icon `<img [src]="navItem.icon">`.

| Element / label | routerLink | Action / Result |
|---|---|---|
| Logo (`augmont-regular.svg`) | `[routerLink]="['/buyer']"` + `(click)="setSelectedSampleAppsSidebarNav('Home')"` | Navigate `/buyer` |
| Close (`pi pi-times`) | `button` | `(click)="closeSidebar()"` — close drawer |
| **Browse** (header) | — | Section title |
| "Lab Grown Diamonds" | `/buyer/products` | Navigate |
| "Lab Grown Melee" | `/buyer/products/melee` | Navigate |
| "Natural Diamonds" | none (comingSoon) | Disabled (opacity-50) |
| "Natural Melee" | none (comingSoon) | Disabled |
| "Resources" | `/buyer/resource` | Navigate |
| "Buy Back" | `/buyer/buyback` | Navigate |
| **My List** (header) | — | Section title |
| "My Orders" | `/buyer/orders` | Navigate |
| "Requests" | `/buyer/requests` | Navigate |
| "My Wishlist" | `/buyer/wishlist` | Navigate |
| **Support and Legal** (header) | — | Section title |
| "Terms and Conditions" | `/buyer/terms-and-conditions` | Navigate |
| "Privacy Policy" | `/buyer/privacy-policy` | Navigate |
| "Return Policy" | `/buyer/return-policy` | Navigate |
| "FAQ" | `/buyer/faq` | Navigate |
| "Contact Us" | `/buyer/contact-us` | Navigate |
| "Settings" | `/buyer/my-account` | Navigate |
| "Log Out" | no routerLink | `onBuyerNavClick` → `setSelectedSampleAppsSidebarNav('Log Out')` → `logout()` |

(Icons are SVGs under `assets/icons/`: lab_grown, lab_grown_melee, natural_diamonds, natural_melee, resources, buyback, my_orders, requests, wishlist, terms_and_conditions, privacy_policy, return_policy, faq, support, setting, logout.)

**Non-buyer (admin/internal) branch** — recursive `navTemplate`. Each menu item: `div.group` with `(click)` = `!isSubmenu ? setSelectedSampleAppsSidebarNav(title) : toggleSubmenu(title)`, `[routerLink]="!isSubmenu ? navItem.routerLink : null"`, chevron `pi pi-chevron-down/right` when submenu. Items filtered by CASL ability (`isMenuItemVisible`) / `requiresSuperAdmin` (userTypeId===1). Full config from `SidebarPermissionService.sidebarConfig`:

| Element / label | routerLink | Permission gate (action / subject) |
|---|---|---|
| Close (`pi pi-times`) | `button` `(click)="closeSidebar()"` | — |
| "Home" (`pi pi-home`) | `/admin` | none |
| "User Management" (submenu, `pi pi-users`) | — (toggle) | visible if any child visible |
| — "Internal Users" | `/admin/internal-users` | `getInternalUser` / List Internal Users |
| — "Sellers" | `/admin/sellers` | `getSeller` / List Sellers |
| — "Buyers" | `/admin/buyers` | `getBuyer` / List Buyers |
| "Orders" (submenu, `pi pi-shopping-cart`) | — (toggle) | any child |
| — "All Orders" | `/admin/orders` | `getAllOrders` / List Orders |
| — "Buy Back Request" | `/admin/buy-back-requests` | any of `buybackDiscountsConfig`/Buyback discounts (config), `buybackRequest`/Buyback Request |
| — "Requests" | `/admin/requests` | `meleeRequestsView` / View Requests |
| "Products" (submenu, `pi pi-box`) | — (toggle) | any child |
| — "Unapproved Products" | `/admin/unapproved-products` | `getUnapprovedProducts` / Unapproved Products |
| — "All Products" | `/admin/all-products` | `getAllProducts` / Get All Products |
| "Configuration" (submenu, `pi pi-cog`) | — (toggle) | any child |
| — "Master" (submenu) | — | `getUserType` / List User Types |
| — — "User Type Master" | `/admin/user-type-master` | `getUserType` / List User Types |
| — "Role and Permission" | `/admin/roles` | requiresSuperAdmin (userTypeId===1) |
| "Contact Us Queries" (`pi pi-envelope`) | `/admin/contact-us-queries` | `getAllContactUs` / View Contact Us Queries |
| "Book A Demo" (`pi pi-calendar`) | `/admin/book-a-demo` | any of `meetingSchedulesView`/Meeting Schedules, `salesTeamManage`/Sales Team |
| "Logout" (`pi pi-sign-out`) | bottom footer `div (click)="setSelectedSampleAppsSidebarNav('Logout')"` | → `logout()` |

### 3f. Footer (authorized) — `src/app/layouts/footer/footer.component.{html,ts}`
Root `<footer.footer>` / `.footer-inner`. Used in authorized layout.

| Element / label | Selector | Handler / link | Action |
|---|---|---|---|
| Logo (`augmont-footer.svg`) | `.footer-logo` | none | Static image |
| Copyright text | `.footer-copy` (`© {{currentYear}} Augmont Enterprise...`) | none | Static |
| Instagram | `a[target="_blank"]` > `i.ph-instagram-logo` | `href` = instagram.com/augmont_lgd | Open new tab |
| Facebook | `a[target="_blank"]` > `i.ph-facebook-logo` | `href` = m.facebook.com profile | Open new tab |
| YouTube | `a[target="_blank"]` > `i.ph-youtube-logo` | `href` = youtube.com/@augmontlgd | Open new tab |
| LinkedIn | `a[target="_blank"]` > `i.ph-linkedin-logo` | `href` = linkedin.com/company/augmont... | Open new tab |

TS: `scrollTop()` (defined, not bound here) scrolls `.layout-content-slot` to top.

### 3g. Public shell — `src/app/layouts/public/public.component.{html,ts}`
Container for public pages. Renders `<app-open-header>` and public `<app-footer>` (both hidden on auth routes via `checkRoute(effectiveUrl())`), `<ng-content>`, `<p-scrollTop class="scroll-to-top" target="window" icon="pi pi-arrow-up">`, and a full-screen navigation overlay (`.nav-overlay`, `#mainContent`).

| Element | Selector | Behavior |
|---|---|---|
| Nav overlay | `.nav-overlay`, `.nav-overlay--visible`, `.nav-overlay--auth` | Loading overlay during navigation (fade 200ms, watchdog 8000ms) |
| Main content | `#mainContent.main-content` | Hidden while navigating to auth routes |
| Open header | `<app-open-header>` | Hidden when `checkRoute(effectiveUrl())` (auth routes) — see §3h |
| Public footer | `<app-footer>` (`pages/public/footer`) | Hidden on auth routes — see §3i |
| Scroll-to-top | `p-scrollTop.scroll-to-top` (`pi pi-arrow-up`) | Scrolls window to top |

Auth routes that hide header/footer (`routes` array): `/login`, `/register`, `/register/verify`, `/register/success`, `/register/business-details`, `/register/company-details`, `/forgot-password` (+`/verify`,`/success`,`/reset`,`/update-password`), `/contact-us/success`, `/download-app`, and regex `/video-360/:id/:token/...`.

### 3h. Public nav (Open Header) — `src/app/pages/public/open-header/open-header.component.{html,ts}`
The actual public navigation bar rendered by the public layout. Root `<header.bg-white>`.

| Element / label | Selector (class / text) | Handler / link | Action |
|---|---|---|---|
| Logo (`augmont-regular.svg`) | `div.cursor-pointer[routerLink="/"]` | `routerLink="/"` | Navigate home |
| Mobile menu toggle | `i.ph-list.md:hidden` | `(click)="isMenuOpen = !isMenuOpen"` | Toggle mobile menu panel |
| "Home" | `a[routerLink="/"]`, routerLinkActive exact | routerLink | Navigate `/` |
| "About Us" | `a[routerLink="/about-us"]` | routerLink | Navigate `/about-us` |
| "Insights" | `a[routerLink="/news-insights"]` | routerLink | Navigate `/news-insights` |
| "Contact Us" | `a[routerLink="/contact-us"]` | routerLink | Navigate `/contact-us` |
| "Submit a Query" | `a[href=zohodesk newticket][target=_blank]` | href | Open Zoho ticket new tab |
| "Book a Demo" | `a[routerLink="/bookademo"]` | routerLink | Navigate `/bookademo` |
| "Log In" (desktop) | `button` (`(mouseenter)/(focusin)="prefetchLogin()"`) | `(click)="goToLogin()"` | Prefetches login; `helperService.goToLoginOrDownload()` → `/login` (desktop) or `/download-app` (mobile) |
| "Sign Up" (desktop, `ph-arrow-right`) | `button.bg-primary` (`prefetchSignUp` on hover/focus) | `(click)="goToSignUp()"` | Prefetch register; `clearStorage()`; `goToSignupOrDownload()` → `/register` (desktop) or `/download-app` (mobile) |
| Mobile "About Us" | `div.text-center` | `(click)="goToPage('/about-us')"` | Close menu + navigate |
| Mobile "Insights" | `div` | `(click)="goToPage('/news-insights')"` | Close menu + navigate |
| Mobile "Contact Us" | `div` | `(click)="goToPage('/contact-us')"` | Close menu + navigate |
| Mobile "Submit a Query" | `div` | `(click)="goSubmitAQuery()"` | Open Zoho ticket new tab |
| Mobile "Log In" | `button` | `(click)="goToLogin()"` | Same as desktop Log In |
| Mobile "Sign Up" | `button.bg-primary` | `(click)="goToSignUp()"` | Same as desktop Sign Up |

(Commented-out country banner with `p-select`, "Continue" `proceedToCountrySite()`, and close `hideCountryHeader()` exists but is disabled.)

### 3i. Public footer — `src/app/pages/public/footer/footer.component.html`
Rendered by public layout. Root `<footer>` gradient.

| Element / label | Selector / link | Handler | Action |
|---|---|---|---|
| Logo (`augmont-footer.svg`) | `img` | none | Static |
| "Home" | `a[routerLink="/"]` | `(click)="scrollTop()"` | Navigate `/` + scroll top |
| "Contact Us" | `a[routerLink="/contact-us"]` | `(click)="scrollTop()"` | Navigate `/contact-us` + scroll top |
| "Insights" | `a[routerLink="/news-insights"]` | `(click)="scrollTop()"` | Navigate `/news-insights` |
| "Submit a Query" | `a[href=zohodesk][target=_blank]` | `(click)="scrollTop()"` | Open Zoho new tab |
| "Sign Up to View All Diamonds" (`ph-arrow-right`) | `button[routerLink="/sign-up"]` | `(click)="goToRegister()"` | `goToRegister()` (note routerLink `/sign-up` has no matching route; handler drives nav) |
| Phone/Email blocks | spans | none | Static contact info |
| Instagram | `button` `ph-instagram-logo` | `(click)="goToPageOther('https://www.instagram.com/augmont_lgd...')"` | Open new tab |
| Facebook | `button` `ph-facebook-logo` | `(click)="goToPageOther('https://www.facebook.com/...')"` | Open new tab |
| YouTube | `button` `ph-youtube-logo` | `(click)="goToPageOther('https://youtube.com/@augmontlgd...')"` | Open new tab |
| LinkedIn | `button` `ph-linkedin-logo` | `(click)="goToPageOther('https://www.linkedin.com/company/...')"` | Open new tab |
| "FAQ" | `a.underline` | `(click)="goToFaq()"` | Navigate to FAQ |
| "Terms and Conditions" | `a[routerLink="/terms-and-conditions"]` | `(click)="scrollTop()"` | Navigate |
| "Privacy Policy" | `a[routerLink="/privacy-policy"]` | `(click)="scrollTop()"` | Navigate |
| "Return Policy" | `a[routerLink="/return-policy"]` | `(click)="scrollTop()"` | Navigate |
| "Disclaimer" | `a[routerLink="/disclaimer"]` | `(click)="scrollTop()"` | Navigate |
| Copyright | `p` (`©2026 Anirath Overseas Limited...`) | none | Static |

---

## 4. Layout selection logic (for test setup)
- `LayoutService` (`src/app/services/common/layout.service.ts`) exposes `PageLayout` enum (`Public`, `Authorized`) set via the `setLayout` resolver on every route and by `authGuard`/logout.
- `AuthorizedComponent` chrome (topbar/sub-topbar/cart-topbar/footer/sidebar) shown only under `buyer`/`seller`/`admin` route trees.
- `PublicComponent` chrome (open-header/public-footer) shown under public routes, auto-hidden on auth routes (login/register/forgot-password/download-app/video-360).
- Role source: `AuthService.getRole()` reads `userRole` from local storage; `isAuthenticated()` requires both `token` and `userRole`.

---

# SECTION: Public Pages Reference (Test-Case / MCP Generation)

> Routes source: `src/app/routes/public.routes.ts`
> All API paths are relative (prefixed with the environment API base by an HTTP interceptor). Auth endpoints live in `src/app/services/common/auth.service.ts`; demo endpoints in `src/app/services/admin/book-demo.service.ts`; contact-us in auth.service.
> Reusable input wrapper: `app-form-control` (`src/app/core/components/form-control/form-control.component.ts`) renders validation error messages. Password field: `app-password`. Mobile/OTP timers are 60s.

## Route Map (public.routes.ts)

| URL | Component | File |
|---|---|---|
| `/` | HomeComponent | `pages/public/home/home.component.ts` |
| `/download-app` | DownloadAppComponent | `pages/public/download-app/download-app.component.ts` |
| `/login` | LoginComponent | `pages/public/login/login.component.ts` |
| `/register` | SignUpComponent (shell) → child `''` SignUpFormComponent | `pages/public/sign-up/...` |
| `/register/verify` | VerifyComponent (sign-up) | `pages/public/sign-up/verify/verify.component.ts` |
| `/register/company-details` | CompanyDetailsComponent | `pages/public/sign-up/company-details/company-details.component.ts` |
| `/register/success` | SuccessComponent (sign-up) | `pages/public/sign-up/success/success.component.ts` |
| `/forgot-password` | ForgotPasswordComponent (shell) → child `''` ForgotPasswordFormComponent | `pages/public/forgot-password/...` |
| `/forgot-password/verify` | VerifyComponent (forgot) | `pages/public/forgot-password/verify/verify.component.ts` |
| `/forgot-password/reset` | ResetPasswordFormComponent | `pages/public/forgot-password/reset-password-form/...` |
| `/forgot-password/update-password` | UpdatePasswordComponent | `pages/public/forgot-password/update-password/...` |
| `/forgot-password/success` | SuccessComponent (forgot) | `pages/public/forgot-password/success/...` |
| `/about-us` | AboutUsComponent | `pages/public/about-us/about-us.component.ts` |
| `/contact-us` (and success `/contact-us/success`) | ContactUsComponent | `pages/public/contact-us/contact-us.component.ts` |
| `/terms-and-conditions` | TermsAndConditionsComponent | static |
| `/return-policy` | ReturnPolicyComponent | static |
| `/disclaimer` | DisclaimerComponent | static |
| `/privacy-policy` | PrivacyPolicyComponent | static |
| `/news-insights` | BlogComponent | `pages/public/blog/blog.component.ts` |
| `/news-insights-details/:slug/:id` | BlogDetailsComponent | `pages/public/blog-details/blog-details.component.ts` |
| `/bookademo` | BookADemoComponent | `pages/public/book-a-demo/book-a-demo.component.ts` |
| `/demo/reschedule?token=` | DemoRescheduleComponent | `pages/public/demo-reschedule/demo-reschedule.component.ts` |
| `/demo/cancel?token=` | DemoCancelComponent | `pages/public/demo-cancel/demo-cancel.component.ts` |

Shared components: `open-header` (public top nav), `footer` (public footer). Both rendered by the Public layout.

---

## Login — `/login`
Files: `pages/public/login/login.component.ts` / `.html`
Form: `loginForm` (Reactive)

| Element/Button | Selector (id/class/text) | Handler | Action/Result |
|---|---|---|---|
| Email/Mobile input | `#mobileNumber`, `formControlName="mobileNumber"`, placeholder "Enter your Email ID or Mobile Number" | — | Required. Lowercased on submit. |
| Password input | `app-password formControlName="password"`, placeholder "Enter your password" | — | Required. |
| Remember Me checkbox | `p-checkbox formControlName="rememberMe"` (binary) | — | Persists `rememberedEmail` in localStorage; prefilled on init. |
| Forgot Password? link | `a[routerLink="/forgot-password"]`, text "Forgot Password?" | routerLink | Navigate `/forgot-password`. |
| Log In button | `button[type=submit]`, text "Log In", `[disabled]="loginForm.invalid"` | `login()` | POST `auth/user-login`. See flow. |
| Go Back | `.cursor-pointer` w/ `pi pi-arrow-left`, text "Go Back" | `goBack()` | If previous URL is a known public route → `location.back()`, else navigate `/`. |
| Sign Up link | text "Sign Up" | `goToSignUp()` | `localStorage.clear()` then navigate `/register`. |
| Augmont logo | `img[routerLink="/"]` | routerLink | Navigate `/`. |

**Flow (login):**
1. Enter email/mobile + password. Button disabled until form valid.
2. Click Log In → `login()`. If invalid: `markAllAsTouched()`, return.
3. mobileNumber lowercased; rememberMe stored/cleared.
4. POST `auth/user-login` with `{mobileNumber, password, rememberMe}`.
5. On success: `res.data` → `role = user.userType.name`; theme forced light.
6. If `user.isFirstLogin` → store `isFirstLogin=true` + token → navigate `/forgot-password/update-password` (STOP).
7. Store `pendingStep`. If pendingStep ≠ `under_review`: clear cart, set currentUser, store token/user/userRole/profileDetails/userTypeId/kycVerified/permissions; call `setUserPermissions()`.
8. Analytics `loginSuccess({method:'website'})`.
9. If `pendingStep`: route by step — `businessDetails`→`/register/business-details`; `companyDetails`→`/register/company-details`; `verify`→`/register/verify`; `under_review`→`/register/success`.
10. Else by role: `buyer`→ initializeForBuyer() + `/buyer`; `seller`→`/seller`; `admin` (or other)→`/admin`.

---

## Sign Up (shell) — `/register`
Files: `pages/public/sign-up/sign-up.component.ts` / `.html`
Renders `<router-outlet>`. Logo click → `/`. `goToLogin()` → `/login`. Removes `dark` class on init.

### Step 1 — Sign Up Form — `/register` (child `''`)
Files: `pages/public/sign-up/sign-up-form/sign-up-form.component.ts` / `.html`
Form: `signUpForm` with cross-field validator `confirmedValidator(password, confirmPassword)`.

| Field | Selector / control | Type | Validators |
|---|---|---|---|
| First Name | `#firstName` `formControlName="firstName"` | text, maxlength 50 | required, trimAndNoWhitespace, maxLength 50 |
| Last Name | `#lastName` `formControlName="lastName"` | text, maxlength 50 | required, trimAndNoWhitespace, maxLength 50 |
| Business Email | `#email` `formControlName="email"` | email | required, email (lowercased on submit) |
| Password | `app-password formControlName="password"` (showIndicator) | password | required, `CustomValidator.passwordValidator` |
| Confirm Password | `app-password formControlName="confirmPassword"` | password | required, passwordValidator + must match password |
| Country | `p-select formControlName="isoCode"` optionValue=isoCode, filterable | select | required; `(onChange)=onCountryChange($event.value)` |
| Mobile Number | `#mobileNumber formControlName="mobileNumber"` | text, dynamic min/max len | required, `onlyNumberWithLength(10,10)` then per-dial validators |
| Referral Code | `#referralCode formControlName="referralCode"` | text | none; `(input)=sanitizeSearchInput()` |
| Terms | `p-checkbox formControlName="terms"` (binary) | checkbox | requiredTrue |

| Button | Selector/text | Handler | Action |
|---|---|---|---|
| Submit | `button[type=submit]` "Continue & Receive OTP", `[disabled]="signUpLoading()||signUpForm.invalid"` | `signUp()` | POST `user/register`. |
| Go Back | `pi pi-arrow-left` "Go Back" | `goToBack()` | public back or `/`. |
| Log In link | `a[routerLink="/login"]` | routerLink | `/login`. |

**Flow (Step 1):**
1. Fill fields. `onCountryChange` resolves dial code, sets mobile validators, shows flag `+code`.
2. Submit → validate; resolve country from isoCode (error toast "Please select a valid country" if none).
3. `signUpLoading=true`; POST `user/register` with `{firstName,lastName,email(lower),password,confirmPassword,countryCode,isoCode,mobileNumber,terms,referralCode}`.
4. On success: merge `res.data` into `registrationData` (localStorage + userService signal); analytics `signup_basic_filled`; navigate `/register/verify`.

### Step 2 — Verify OTP — `/register/verify`
Files: `pages/public/sign-up/verify/verify.component.ts` / `.html`
Form: `verifyForm` — `emailCode, emailOtp, countryCode, mobileCode, mobileOtp` (all required). Two 6-digit `p-inputotp` fields (email + mobile), each with 60s timer.

| Element | Selector/text | Handler | Action |
|---|---|---|---|
| Email OTP | `p-inputotp formControlName="emailOtp"` length 6 | — | required |
| Mobile OTP | `p-inputotp formControlName="mobileOtp"` length 6 | — | required |
| Resend Email Code | `a` "Resend Code" (shown when emailTimer=0) | `resendEmailOtp()` | POST `user/send-otp` `{mobileNumber:email,countryCode,type:'register'}`; resets email timer. |
| Resend Mobile Code | `a` "Resend Code" | `resendMobileOtp()` | POST `user/send-otp` `{mobileNumber,countryCode,type:'register'}`; resets mobile timer. |
| Continue | `button[type=submit]` "Continue", `[disabled]="verifyLoading()||verifyForm.invalid"` | `verify()` | POST `user/verify-register-otp`. |
| Go Back | `pi pi-arrow-left` | `goToBack()` | `/register`. |

**Flow (Step 2):**
1. Email + mobile OTP codes prefilled from `registrationData.emailOtpCode/mobileOtpCode` (patch on init).
2. Enter both 6-digit OTPs.
3. Submit → POST `user/verify-register-otp` with full form value.
4. On success: store `onboardingToken` into registrationData + as `token`; clear timers; analytics `signup_otp_verified`; navigate `/register/company-details`.

### Step 3 — Company Details — `/register/company-details`
Files: `pages/public/sign-up/company-details/company-details.component.ts` / `.html`
Form: `signUpForm` (company + `userAddress` group + `isShippingAddress` toggle + `shippingAddress` group).

| Field | Selector / control | Validators |
|---|---|---|
| Registration Number | `#registrationNumber formControlName="registrationNumber"` (label dynamic via KYC config) | required + pattern from KYC config (India GSTIN / US EIN fallback) |
| Company Name | `#companyName` | required, maxLength 255 |
| Trading Name | `#tradingName` | maxLength 255 |
| Company Website | (control `companyWebsite`) | URL pattern |
| Shipping toggle | `p-toggleSwitch formControlName="isShippingAddress"` | `(onChange)=toggleShippingAddress()` sets/clears shipping validators |
| Shipping Address Line 1/2 | `#shippingAddressLine1/2` | line1 required (when shown), maxLength 255 |
| Country/State/City | `p-select` countryId/stateId/cityId (filterable) | required when shipping; country disabled if pre-resolved |
| Pincode | `#shippingPincode` | per-dial pincode validators, dynamic min/max len |

| Button | Selector/text | Handler | Action |
|---|---|---|---|
| Verify | `p-button` text "Verify"/"Verified" (hidden if manual KYC) | `verifyRegistration()` | POST `user/lookup-registration`. |
| Reset | `p-button` "Reset" (after verified) | `resetVerification()` | Re-enables fields, clears verified state. |
| Confirm | `button[type=submit]` "Confirm", `[disabled]="!canConfirm()"` | `signUp()` | POST `user/onboarding`. |
| Go Back | `pi pi-arrow-left` | `goToBack()` | `/register`. |

**Flow (Step 3):**
1. On init: load countries (`lookup country`), then `getKycConfig()` (GET `user/kyc-config`) → sets registration label + pattern; manual-verification countries skip auto lookup and require registered address entry.
2. Enter registration number + company name → click Verify → POST `user/lookup-registration` `{registrationNumber,companyName,tradingName}`.
   - Success + verified: show "Registered Company Information" card; disable reg fields.
   - `requiresManualVerification` / error: show warning; require shipping/registered address.
3. Optionally toggle "Use Different Shipping Address" → fill address group.
4. Confirm → validate + `canConfirm()` → build payload (registeredAddress / shippingAddress depending on verified vs manual) → POST `user/onboarding`.
5. On success: clear cart, set currentUser/token/user/userRole/isoCode/kycVerified; analytics `signup_completed`; navigate `/register/success`.

### Step 4 — Success — `/register/success`
Files: `pages/public/sign-up/success/success.component.ts` / `.html`

| Button | Selector/text | Handler | Action |
|---|---|---|---|
| Launch the Augmont Platform | `button[type=button]`, `[disabled]="launchLoading()"` | `proceedToPlatform()` | Set currency if needed; navigate by role: buyer→initialize+`/buyer`, seller→`/seller`, else `/admin`. |

---

## Forgot Password (shell) — `/forgot-password`
Files: `pages/public/forgot-password/forgot-password.component.ts` / `.html` — renders `<router-outlet>`; logo→`/`.

### Step 1 — Request — `/forgot-password` (child `''`)
Files: `.../forgot-password-form/forgot-password-form.component.ts` / `.html`
Form: `resetPasswordForm` — `mobileNumber` (validators: email + required; note control named mobileNumber but validated as email).

| Element | Selector/text | Handler | Action |
|---|---|---|---|
| Business Email | `#email formControlName="mobileNumber"` type email, placeholder "Enter your Business Email ID" | — | required + email |
| Continue | `button[type=submit]` "Continue", `[disabled]="resetPasswordForm.invalid"` | `resetPassword()` | POST `user/send-otp`. |
| Back to Log In | `pi pi-arrow-left` | `goToBack()` | `/login`. |

**Flow:** enter email → Continue → POST `user/send-otp` `{mobileNumber(lower),type:'forgot_password'}` → store `forgotPasswordData` → navigate `/forgot-password/verify`.

### Step 2 — Verify — `/forgot-password/verify`
Files: `.../forgot-password/verify/verify.component.ts` / `.html`
Form: `verifyForm` — `code`, `otp` (required). Single 6-digit `p-inputotp`. 60s timer.

| Element | Selector/text | Handler | Action |
|---|---|---|---|
| OTP | `p-inputotp formControlName="otp"` length 6 | — | required (code prefilled from stored otpCode) |
| Resend Code | `a` "Resend Code" (timer=0) | `resendEmailOtp()` | POST `user/send-otp` `{mobileNumber,type:'forgot_password'}`. |
| Submit & Reset Password | `button[type=submit]`, `[disabled]="verifyForm.invalid"` | `verify()` | POST `user/verify-otp`. |
| Back to Log In | `pi pi-arrow-left` | `goToLogin()` | `/login`. |

**Flow:** enter OTP → Submit → POST `user/verify-otp` → store `forgotPasswordToken` as `token` → navigate `/forgot-password/reset`.

### Step 3 — Set New Password — `/forgot-password/reset`
Files: `.../reset-password-form/reset-password-form.component.ts` / `.html`
Form: `resetPasswordForm` — `password`, `confirmPassword` (required + passwordValidator + match).

| Element | Selector/text | Handler | Action |
|---|---|---|---|
| New Password | `app-password formControlName="password"` (showIndicator) | — | required, passwordValidator |
| Confirm New Password | `app-password formControlName="confirmPassword"` | — | required + match |
| Confirm | `button[type=submit]` "Confirm", `[disabled]="resetPasswordForm.invalid"` | `resetPassword()` | POST `user/change-password`. |
| Back to Log In | `pi pi-arrow-left` | `goToLogin()` | `/login`. |

**Flow:** enter matching passwords → Confirm → POST `user/change-password` `{password,confirmPassword}` → navigate `/forgot-password/success`.

### Update Password (first-login) — `/forgot-password/update-password`
Files: `.../update-password/update-password.component.ts` / `.html`
Form: `updatePasswordForm` — same fields/validators as reset.

| Element | Selector/text | Handler | Action |
|---|---|---|---|
| New / Confirm Password | `app-password` password/confirmPassword | — | required + passwordValidator + match |
| Update Password | `button[type=submit]`, `[disabled]="updatePasswordForm.invalid"` | `updatePassword()` | POST `user/new-password` → navigate `/forgot-password/success`. |
| Back to Log In | `pi pi-arrow-left` | `goToLogin()` | `/login`. |

**Note:** Reached from Login when `isFirstLogin=true`.

### Success — `/forgot-password/success`
Files: `.../forgot-password/success/success.component.ts` / `.html`

| Button | Selector/text | Handler | Action |
|---|---|---|---|
| Continue to Login | `button[routerLink="/login"]` "Continue to Login" | routerLink | `/login`. |
| Back to Log In | `pi pi-arrow-left` | `goToLogin()` | `/login`. |
| (also) `proceedToPlatform()` | — | `proceedToPlatform()` | `localStorage.clear()` + `/login`. |

---

## Contact Us — `/contact-us`
Files: `pages/public/contact-us/contact-us.component.ts` / `.html`
Form: `contactUsForm` (declared in TS). **Note:** the current `.html` (93 lines) renders only the header + contact-info blocks (Phone India/USA, Email `platform.support@augmont.com`, Office Hours) and, for buyer route, a "Back to Catalog" button (`goBackToCatalog()`→`/buyer/products`). The `<form>` markup with the fields below is NOT present in the template — the form logic is currently unrendered in this HTML.

Declared form fields / validators (TS, for reference):

| Field | Control | Validators |
|---|---|---|
| First Name | `firstName` | required, noWhitespace, maxLength 255 |
| Last Name | `lastName` | required, noWhitespace, maxLength 255 |
| Email | `email` | required, emailValidator, maxLength 255 |
| Country Code | `countryCode` (default `+91`) | required |
| Mobile Number | `mobileNumber` | required, `onlyNumberWithPlusLength(5,14)` |
| Message | `message` | required, noWhitespace, maxLength 1000 |

| Handler | Action |
|---|---|
| `submitContactUs()` | Validate; append countryCode to mobileNumber; POST `contact-us` (header `X-Loader-Skip:true`) → reset form → navigate `/contact-us/success`. |
| `toggleDropdown()` / `filterCountries()` / `selectCountry()` | Country-code dropdown control. |
| `isBuyerRoute()` / `goBackToCatalog()` | Buyer-context back nav to `/buyer/products`. |

---

## Home — `/`
Files: `pages/public/home/home.component.ts` / `.html`
Composed of deferred child sections: `app-hero`, `app-companies`, `app-collection`, `app-buyback`, `app-reviews`, `app-stats`, `app-mobile-app`, `app-help-cta`. (`app-contact-cta` exists but is not in home template.)

### Hero (`home/hero`)
| Button | Selector/text | Handler | Action |
|---|---|---|---|
| Sign Up to Explore | `button` text "Sign Up to Explore" | `goToSignUp()` | `helperService.goToSignupOrDownload()` → mobile: `/download-app`, else `/register`. |
| Book a Demo | `button` text "Book a Demo" | `goToBookDemo()` | `/bookademo`. |

### Collection (`home/collection`)
| Button | Handler | Action |
|---|---|---|
| Prev arrow | `prev()` | Carousel previous. |
| Next arrow | `next()` | Carousel next. |

### Reviews (`home/reviews`)
| Button | Handler | Action |
|---|---|---|
| Prev | `goPrev()` | Testimonials carousel prev. |
| Next | `goNext()` | Testimonials carousel next. |
| (dot) | `goToIndex(i)` | Jump to testimonial. |

### Mobile App (`home/mobile-app`)
| Button | Handler | Action |
|---|---|---|
| Google Play | `openPlayStore()` | `window.open(Play Store URL,'_blank')`. |
| App Store | `openAppStore()` | `window.open('https://apps.apple.com/in/app/augmont-lab-grown-diamonds/id6749539399','_blank')`. |

### Help CTA (`home/help-cta`)
| Button | Text | Handler | Action |
|---|---|---|---|
| Schedule a Demo | "Schedule a Demo" | `goToDemo()` | `/bookademo`. |
| Submit a Query | "Submit a Query" | `goToQuery()` | `window.open('https://augmont.zohodesk.in/portal/en/newticket','_blank')`. |

`buyback`, `companies`, `stats` sections: static/display only (no click handlers).

---

## Book a Demo — `/bookademo`
Files: `pages/public/book-a-demo/book-a-demo.component.ts` / `.html`
Form: `form` (FormBuilder). 3-column layout: form / calendar / time slots. Success modal on booking.

| Field/Element | Selector | Handler | Validators/Action |
|---|---|---|---|
| Full Name | `formControlName="fullName"`, placeholder "Enter Full Name" | — | required. Error "Full name is required." |
| Email ID | `formControlName="email"` type email | — | required + pattern; errors "Email is required." / "Please enter a valid email address." |
| Company Name | `formControlName="companyName"` | — | required. Error "Company name is required." |
| Country code button | `button[type=button]` (flag + code) | toggles `showCountryDropdown` | Opens searchable country list. |
| Country search | `[(ngModel)]="countrySearch"` | `filteredCountryCodes` / `selectCountry(value,flag)` | `selectCountry()` sets code + `onCountryCodeChange()` (reloads slots). |
| Phone | `formControlName="phone"` type tel, `(keypress)=onlyNumbers()` | — | required + pattern `^\d{10}$`; errors "Phone number is required." / "Please enter a valid 10-digit phone number." |
| Role radios | `[(ngModel)]="selectedRole"` values supplier/buyer/other | — | "Other" reveals `otherRole` text input. |
| Prev/Next month | `prevMonth()` (disabled if current/past) / `nextMonth()` | — | Calendar nav; clears selectedDate/slot. |
| Calendar day | `button (click)=selectDate(day)` `[disabled]=isPast(day)` | `selectDate()` | GET `demo/available-slots?date&countryCode` → `availableSlots`. |
| Time slot | `button (click)=selectSlot(slot.start)` | `selectSlot()` | Sets `selectedSlot`. |
| Confirm Demo | `button` text "Confirm Demo"/"Booking…", disabled if form invalid / no date / no slot / submitting | `onSubmit()` | POST `demo/book`. |
| Success modal Done / Close | `onDone()` | `onDone()` | Navigate `/`. |

**Flow:** fill form → pick country (reloads slots) → select date (GET `demo/available-slots`) → select slot → optional role → Confirm → POST `demo/book` `{name,email,phone,companyName,countryCode,message(role/otherRole),selectedTime}` → success modal → Done → `/`.

---

## Demo Reschedule — `/demo/reschedule?token=`
Files: `pages/public/demo-reschedule/demo-reschedule.component.ts` / `.html`
Loads booking by `token` query param. States: loading / error / past-meeting (canReschedule=false) / main card / success modal.

| Element | Selector/text | Handler | Action |
|---|---|---|---|
| Go to Home (error/past) | `button` | `onDone()` | `/`. |
| Prev/Next month | buttons | `prevMonth()`/`nextMonth()` | Calendar nav (clears selection). |
| Calendar day | `button (click)=selectDate(day)` | `selectDate()` | GET `demo/available-slots?date&countryCode(from booking)`. |
| Time slot | `button (click)=selectSlot(start,end)` | `selectSlot()` | Sets new slot; shows in "New Schedule". |
| Confirm Reschedule | `button` "Confirm Reschedule"/"Rescheduling…", disabled if no slot / submitting | `onSubmit()` | POST `demo/reschedule` `{token, selectedTime}`. |
| Success modal Done/Close | `onDone()` | `onDone()` | `/`. |

**Flow:** ngOnInit reads `token`; if missing → error "Invalid link…". GET `demo/booking?token` → booking. If `canReschedule` false → past-meeting notice. Else pick date+slot → Confirm → POST `demo/reschedule` → success modal (or `submitError`).

---

## Demo Cancel — `/demo/cancel?token=`
Files: `pages/public/demo-cancel/demo-cancel.component.ts` / `.html`
Loads booking by `token`. States: loading / error / confirmation card / cancelled modal.

| Element | Selector/text | Handler | Action |
|---|---|---|---|
| Go to Home (error) | `button` | `goHome()` | `/`. |
| Keep My Demo / Go to Home | `button` (label depends on `canCancel`) | `goHome()` | `/`. |
| Cancel My Demo | `button` "Cancel My Demo"/"Cancelling…", `[disabled]=cancelling` (only if `canCancel`) | `onCancel()` | POST `demo/cancel` `{token}`. |
| Cancelled modal Done/Close | `goHome()` | `goHome()` | `/`. |

**Flow:** ngOnInit reads `token` (missing→error). GET `demo/booking?token` → booking (fullName/date/time/salesPerson). If `canCancel`: show warning "This action cannot be undone." Click Cancel My Demo → POST `demo/cancel`. Errors: 400 "Cannot cancel a meeting that has already passed.", 404 "Booking not found or already cancelled." On success → cancelled modal.

---

## Blog / News-Insights — `/news-insights`
Files: `pages/public/blog/blog.component.ts` / `.html`
Uses `NewsService` (`insights`, `getCategories`, WordPress-style data). Pagination (6/page).

| Element | Selector/text | Handler | Action |
|---|---|---|---|
| Category filter chips | `button` per `blogTypes`, active class when `blogType==id` | `changeValueType(id)` | Reset to page 1, reload insights. |
| Blog card | `div (click)=goToDetails(item.id,item.categories[0],item.slug)` | `goToDetails()` | Navigate `/news-insights-details/:slug/:id?category=`. |
| Previous | `button (click)=onPrevPage()` `[disabled]=currentPage===1` | `onPrevPage()` | Prev page + scroll top. |
| Next | `button (click)=onNextPage()` `[disabled]=currentPage===totalPages` | `onNextPage()` | Next page. |
| Page number | `button (click)=goToPage(+page)` | `goToPage()` | Jump to page. |

Empty state: "No blogs available."

---

## Blog Details — `/news-insights-details/:slug/:id`
Files: `pages/public/blog-details/blog-details.component.ts` / `.html`
Loads post by `id` (GET post) + related by `category` query param. Sets SEO meta/title/schema. Renders sanitized HTML content.

| Element | Selector/text | Handler | Action |
|---|---|---|---|
| Go Back | `button (click)=goBack()` "Go Back" | `goBack()` | `/news-insights`. |
| Related news item | `div (click)=goToDetails(item.id,item.categories[0],item.slug)` | `goToDetails()` | Navigate to that post details. |

Empty related state: "No related news available."

---

## About Us — `/about-us`
Files: `pages/public/about-us/about-us.component.ts` / `.html` (largely static content + team + FAQ).

| Element | Selector/text | Handler | Action |
|---|---|---|---|
| Team LinkedIn (Aarav Bafna) | `(click)=goToPageOther('https://www.linkedin.com/in/aarav-bafna')` | `goToPageOther()` | `window.open(link,'_blank')`. |
| Team LinkedIn (Ketan Kothari) | `.../in/kothariketan` | `goToPageOther()` | New tab. |
| Team LinkedIn (Priyank Kothari) | `.../priyank-kothari-8235b7174` | `goToPageOther()` | New tab. |
| FAQ section | `<app-faq-section>` inside `section#faq` | — | See FAQ component. |

**FAQ component** (`pages/common/faq-section/faq-section.component.*`): category tab buttons set `faqsType` = `platform` / `benchmarkPricing` / `buybackGuarantee` / `invoicing` / `delivery`; content is a PrimeNG `p-accordion` (`p-accordion-panel` / `p-accordion-header` / `p-accordion-content`) — click headers to expand answers. Anchor `#faq` targeted from footer FAQ link.

---

## Download App — `/download-app`
Files: `pages/public/download-app/download-app.component.ts` / `.html`
Detects device (iOS/Android/other) via `MobileDetectionUtil`.

| Element | Selector/text | Handler | Action |
|---|---|---|---|
| Logo | `img[routerLink="/"]` | routerLink | `/`. |
| Google Play badge | `a (click)=downloadApp($event)` (shown Android/other) | `downloadApp()` | `window.open(getAppStoreUrl(),'_blank')`. |
| App Store badge | `a (click)=downloadApp($event)` (shown iOS/other) | `downloadApp()` | Same, store URL by platform. |
| (TS) `goBack()` / `redirectToApp()` | — | — | `/` ; `MobileDetectionUtil.redirectToApp()`. |

---

## Static Legal Pages
`/terms-and-conditions`, `/return-policy`, `/disclaimer`, `/privacy-policy` — content-only components. No forms; navigation only via header/footer.

---

## API Endpoint Summary (relative paths)

| Action | Method + Path | Source |
|---|---|---|
| Login | POST `auth/user-login` | auth.service `login()` |
| Register (step1) | POST `user/register` | auth.service `register()` |
| Verify register OTP | POST `user/verify-register-otp` | `verifyOtp()` |
| Send OTP (register/forgot) | POST `user/send-otp` | `sendOtp()` |
| Verify OTP (forgot) | POST `user/verify-otp` | `verifyDirectOtp()` |
| KYC config | GET `user/kyc-config` | `getKycConfig()` |
| Lookup registration | POST `user/lookup-registration` | `verifyRegistrationNumber()` |
| Company onboarding | POST `user/onboarding` | `updateCompanyDetails()` |
| Change password (forgot reset) | POST `user/change-password` | `changePassword()` |
| New password (first login) | POST `user/new-password` | `updatePassword()` |
| Contact us | POST `contact-us` (`X-Loader-Skip`) | `sendContactUs()` |
| Available demo slots | GET `demo/available-slots?date&countryCode` | book-demo.service `getAvailableSlots()` |
| Book demo | POST `demo/book` | `submitBookingRequest()` |
| Get booking | GET `demo/booking?token` | `getBooking()` |
| Cancel booking | POST `demo/cancel` | `cancelBooking()` |
| Reschedule booking | POST `demo/reschedule` | `rescheduleBooking()` |
| Lookup location (country/state/city) | via LookupService `getLocationData()` | used in sign-up/company details |
| News/insights | NewsService `insights`/`getCategories`/`getPostById`/`getPostCategoryWize` | blog pages |

---

# SECTION: Buyer Pages Reference

Base path for all buyer pages: `/buyer`. Routes defined in `src/app/routes/buyer.routes.ts` (guarded by `authGuard`, role `buyer`, layout `Authorized`). Global cart drawer (`app-cart-popover`, opened via `productService.cartPopoverEvent`) appears after any add-to-cart across the app.

---

## 1. Home
Route: `/buyer` (`HomeComponent`)
Files: `src/app/pages/buyer/home/home.component.html`, `.ts`

The active template renders only `<app-filters-full-page />` (a common component). The pricing-tool block (shape/weight selects, search button) is fully commented out. The `.ts` still holds the logic below (dormant unless the commented block is re-enabled).

| Element/Button | Selector (id/class/text) | Handler | Action/Result |
|---|---|---|---|
| Shape select (commented) | `p-select` "Select Shape" | `getPricings()` | Persists `selectedShape`, refetches pricing via `productService.fetchFilteredPricingData` |
| Weight select (commented) | `p-select` "Select Weight" | `getPricings()` | Persists `selectedWeight`, refetches pricing |
| Search button (commented) | `button[pButton]` `pi-search` | `goToSearchPage()` | Clears filters (`userService.filters`, localStorage `savedFilters`), navigates `/buyer/products` |

Flow (only active behavior): page renders the full-page filters component (`app-filters-full-page`) which drives navigation to product search.

---

## 2. Products (search / list)
Route: `/buyer/products` (`ProductsComponent`)
Files: `src/app/pages/buyer/products/products.component.html`, `.ts`
Sub-components: `product-grid`, `product-card`, `save-filter-popover`, `share-stone`, `load-more-loader`, `product-list-skeleton`; common `app-filters`, `app-hover-action-bar`, `app-request-detail-dialog`.

### Top bar / filter controls
| Element/Button | Selector (id/class/text) | Handler | Action/Result |
|---|---|---|---|
| Result count | text "Showing {n} Diamonds…" | `getProductCount()` | Reads `productService.productCount()` |
| Saved Searches | `#saveFilterButton .filter-bar-btn` "Saved Searches" | `toggleSaveFilter($event)` | Opens `SaveFilterPopoverComponent` popover |
| Grid view toggle | `.ph-grid-four` btn | `setLayoutMode('grid')` | `layoutService.toggleGridMode()` |
| Table view toggle | `.ph-list-dashes` btn | `setLayoutMode('table')` | Switches to table layout |
| Set Filters | `button[pButton]` "Set Filters" | `openFiltersFullPage()` | Opens `app-filters` drawer (`showDrawer=true`, tab 'main') |
| Search input | `input[pInputText]` placeholder "Search with cert number or SKU Id" | `sanitizeSearchInput`, `onSearchPaste`, blur/enter→`filterTopBar(lgdStockNum(),'lgdStockNum')` | Sets `search` filter, refetch; logs analytics (SKU vs cert) |
| Location select | `p-select` "Location" (only if countryCode≠91) | `filterTopBar($event,'country')` | Adds `country` filter |
| Price | `.filter-bar-btn` "Price" | `showPriceFilterDialog.set(true)` | Opens Price dialog |
| Sort by | `p-select` sorting-dropdown | `onSortChange($event)` | Sets sort key/type, persists `productSortOption`, refetch |
| Video toggle | `.filter-bar-media-toggle-segment` "Video" | `hasVideo.set(!…); filterTopBar(hasVideo(),'hasVideo')` | Toggles `hasVideo` filter |
| Photo toggle | segment "Photo" | `hasImage.set(!…); filterTopBar(hasImage(),'hasImage')` | Toggles `hasImage` filter |
| Availability switch | `p-toggleSwitch` "Availability" | `availableProduct.set(!…); filterTopBar(...,'availableProduct')` | Toggles availability filter |
| Buy Back switch | `p-toggleSwitch` "Buy Back" | `toggleBuyBack()` | Toggles `hasBuyback` filter |
| Clear Filter chip | `p-button.clear-filter-btn` "Clear Filter" | `clearAllFilters()` | Resets all filters + sort to defaults, refetch |
| Range chip ✕ | `.pi-times` | `removeRangeFilter(minKey,maxKey)` | Removes a min/max range filter |
| Multi-value chip ✕ | `.pi-times` | `removeFilterValue(filter,val)` | Removes one value from a multi-value filter |
| Single chip ✕ | `.pi-times` | `removeFilter(filter)` | Removes a filter |

### Grid mode
Renders `app-product-grid` → `app-product-card` per item. Outputs `requestPhoto`→`onRequestPhoto`, `shareStone`→`onShareStone`.

### Table mode (per-row / bulk)
| Element/Button | Selector | Handler | Action/Result |
|---|---|---|---|
| Row (whole `<tr>`) | table row | `navigateToProductDetail(id)` | → `/buyer/products/:id` |
| Row checkbox | `p-checkbox` (hidden if in cart/unavailable) | `handleCheckboxChange($event,row)` | Adds/removes from `selectedProducts` |
| Header select-all | `p-checkbox` indeterminate | `handleAllCheckboxChange($event)` | Selects all not-in-cart rows |
| Column header | `th[click]` | `sortByCol(col.sortKey)` | Toggles ASC/DESC sort |
| Certificate download | `.ph-download-simple` | `downloadCertificate(row)` | GIA→opens gia.edu; IGI→`fetchProductCertificate` blob download |
| Wishlist heart | `.ph-heart` | `isInWishlist?removeFromWishlist:addToWishlist` | `wishlistService.add/removeFromWishlist(id)` |
| Cart bag | `.ph-shopping-bag` | `handleCartAction($event,row)` | Add/remove cart; opens cart popover |
| Media request | `app-media` (requestPhoto) | `onRequestPhoto(row, getMissingMediaTypes(row))` | Opens request-detail dialog |
| Hover action bar "Add to cart" | `p-button` "Add to cart" | `addHoverActionToCart($event)` | Bulk add `selectedProducts` to cart |

### Price dialog (`p-dialog`)
Form `priceFilterFormGroup` fields: `minFinalPrice`, `maxFinalPrice` (Validators.min(0), maxZeroValidator), `minPricePerCarat`, `maxPricePerCarat`; group validator `rangeGroupValidator`. Tabs "Price"/"Price/ct" (`priceFilterValue.set`). Cancel→close; Apply Filters (disabled unless `isPriceFilterValid()`)→`applyPriceFilter()` then close.

### Flows
1. Search/filter → add to cart: enter cert/SKU or set filters (Set Filters drawer / Price dialog / toggles) → list refetches via `fetchProducts` (infinite scroll via `loadMoreSentinel`) → click cart bag/"Add to Cart" → item in `userService.cart`, cart popover opens → proceed to checkout from popover.
2. Bulk add: switch to table view → check rows → hover action bar shows totals → "Add to cart".
3. Wishlist: click heart on card/row → toggles wishlist.
4. Request details/photo: click "Request Details" (card) or media request → `RequestDetailDialogComponent` opens preselected with missing media types.
5. Share stone: card share → `onShareStone` opens `ShareStoneService` dialog (`app-share-stone`).
6. Save search: "Saved Searches" → popover save/apply.

---

## 2a. Product Card (sub-component)
Files: `src/app/pages/buyer/products/product-card/product-card.component.html`, `.ts`

| Element/Button | Selector (class/text) | Handler | Action/Result |
|---|---|---|---|
| Wishlist heart | `.ph-heart` top-right | `isInWishlist()?removeFromWishlist():addToWishlist()` | Toggle wishlist |
| Download dialog | `app-download-dialog` | (common) | Download image/video if available |
| Share | `app-share` | (common) | Share menu |
| View similar | `.ph-sketch-logo` "View similar products" | `navigateToSimilarProducts(id)` | → `/buyer/match-pair/:id?from=products` |
| Title | `h2[click]` | `navigateToProductDetail($event,id)` | → product detail |
| Copy SKU | `.ph-copy` | `helperService.copyToClipboard(lgdStockNum)` | Copies SKU |
| Request Details | button "Request Details" | `requestPhoto.emit({product,preselectedTypes:['diamond_image','diamond_video']})` | Opens request dialog |
| Unavailable | disabled button "Unavailable" | — | Disabled |
| Added to Cart | button "Added to Cart" | `handleCartAction($event)` | Remove from cart |
| Add to Cart | button "Add to Cart" (animated) | `handleCartAction($event)` | `productService.addToCart([diamond])`, 2.1s animation then cart popover |

---

## 2b. Product Detail
Route: `/buyer/products/:productId` (`ProductDetailComponent`)
Files: `src/app/pages/buyer/products/product-detail/product-detail.component.html`, `.ts`

| Element/Button | Selector (class/text) | Handler | Action/Result |
|---|---|---|---|
| Back to Search | `p-button` "Back to Search" | `back()` | → `/buyer/products` |
| Certificate | `p-button` "Certificate" (IGI/GIA only) | `productService.openProductCertificate(product())` | Opens/downloads cert |
| Share | `app-share` | (common) | Share |
| Copy SKU | `.ph-copy` | `helperService.copyToClipboard(lgdStockNum)` | Copy |
| Add to Cart / Remove from Cart | animated button | `handleCartAction($event)` | Add/remove cart, cart popover |
| Wishlist / Remove from wishlist | `p-button` heart | `isInWishlist()?removeFromWishlist():addToWishlist()` | Toggle wishlist |
| Unavailable | disabled button | — | Disabled |
| Similar product card | `app-product-card` | `onRequestPhoto(...)` | Request dialog for similar item |
| View More Suggestions | `p-button` | `navigateToSimilarProducts()` | → `/buyer/match-pair/:id?from=product-detail` |
| Scrollable tags request | `app-scrollable-tags` (requestDetail) | `onRequestPhoto($event.product,...)` | Request shade/luster/photo dialog |

Dialogs: `app-share-stone` (share stone), `app-request-detail-dialog`. Specs rendered via `app-diamond-specifications` (`diamondSpecs()`).

Flow: open detail → view specs / recommended matches → add to cart / wishlist → request details → download certificate → checkout via cart popover.

---

## 3. Melee Products
Route: `/buyer/products/melee` (`MeleeProductsComponent`, data `{productLine:'melee'}`)
Files: `src/app/pages/buyer/melee-products/melee-products.component.html`, `.ts`
Sub-components: `melee-product-grid`→`melee-product-card`, `melee-product-table`, `melee-selection-popup`, `make-request` (+ select-details, quantity-details, request-preview), skeletons; common `app-filters`, `save-filter-popover`.

### Top bar
| Element/Button | Selector (class/text) | Handler | Action/Result |
|---|---|---|---|
| Saved Searches | `#saveFilterButton` | `toggleSaveFilter($event)` | Save-filter popover (productLine melee) |
| Grid/Table toggle | `.layout-toggle-btn` | `setLayoutMode('grid'|'table')` | Toggle layout |
| Set Filters | `button[pButton]` "Set Filters" | `openFiltersFullPage()` | Opens `app-filters productLine="melee"` |
| Search input | placeholder "Search by shape, color, clarity, cut or size…" | `onSearchInput` (400ms debounce), blur/enter→`applySearch()` | Sets `search` filter, refetch |
| Sort by | `p-select` (Price/Ct asc/desc) | `onSortChange($event)` | Sort refetch |
| Clear Filter | `p-button` "Clear Filter" | `clearAllMeleeFilters()` | Reset melee filters |
| Filter chip ✕ (multi) | `.pi-times` | `removeSingleMeleeFilterValue(filter,val)` | Remove one value |
| Filter chip ✕ (single) | `.pi-times` | `removeMeleeFilter(filter)` | Remove filter |
| Make a Request (empty state) | `.melee-empty-request-btn` "Make a Request" | `openMakeRequest()` | Prefills request data, opens `app-make-request` dialog |

### Card (`melee-product-card`)
| Element/Button | Selector (text) | Handler | Action/Result |
|---|---|---|---|
| Wishlist heart | `.melee-card-action-btn` | `isInWishlist()?removeFromWishlist():addToWishlist()` | Remove: `removeFromWishlist(id,'MELEE')`; Add: opens selection popup mode 'wishlist' |
| Select Quantity | button "Select Quantity" | `handleCartAction($event)` | Emits `openSelectionPopup {mode:'cart'}` |

### Table (`melee-product-table`)
| Element/Button | Selector (text) | Handler | Action/Result |
|---|---|---|---|
| Wishlist | `.table-wishlist-btn` heart | `isInWishlist(row)?removeFromWishlist(row):addToWishlist(row)` | Toggle / open popup mode 'wishlist' |
| Select Quantity | `.table-select-qty-btn` | `handleCartAction($event,row)` | Open selection popup mode 'cart' |
| Sortable columns | `pSortableColumn` mmMin/avgCaratPerStone/pricePerCarat | `customSort` | Numeric sort |

### Selection popup (`melee-selection-popup`)
Inputs Carat / Pieces (mutually driven; `onCaratInput`/`onPiecesInput`, numeric-only). Errors from `quantityError` (exceeds stock, whole-number pieces, hard cap 999999). Note add/edit/delete (`showNoteInput`, `saveNote`). Price via `meleeService.calculateMeleePrice`.
- Close/Cancel → `handleClose()`
- Add to Cart (disabled unless `canSubmit()`) → `addToCart()` emits `onAddToCart` → parent `handleAddToCartFromPopup` → `productService.addMeleeToCart`, cart popover
- Add to Wishlist → `addToWishlist()` emits `onAddToWishlist` → `handleAddToWishlistFromPopup` → `wishlistService.addMeleeToWishlist`

### Success dialog
"Done"→`onDone()` (close); "View Request"→`onViewRequest()`→ `/buyer/requests`.

### Flows
1. Filter/search melee → grid/table → "Select Quantity" → enter carat/pieces + note → Add to Cart → cart popover.
2. Add melee to wishlist via popup.
3. Make a Request (no results) → multi-step dialog (see 3a) → success → View Request.

---

## 3a. Make Request (melee) — multi-step dialog
Files: `src/app/pages/buyer/melee-products/make-request/make-request.component.html`, `.ts` + `select-details`, `quantity-details`, `request-preview`. Used by melee-products, requests view-request (edit).

Header close ✕ → `closeModal.emit()`. Footer: progress bar `activeStep/3`; "Go Back" → step1 closes else `prevStep()`; primary button → step3 `submitRequest()` else `nextStep()` (disabled by `isNextDisabled()`).

Form `filterFormGroup`: `minCarat`, `maxCarat`, `colorType`('white'), `fancyColor`, `fancyColorIntensity`, `fancyColorOvertone`, `clarity[]`, `growthType`('HPHT'), `unitType`(required), `sizes` FormArray of `{unitType,quantity,length,width,depth}` (all required), `details`. `selections` sets: shape/carat/color/clarity/melee_cut.

- Step 1 `select-details`: toggle shape/cut/clarity/color selections (`toggleSelection`), color type white vs fancy. Next disabled unless shape+cut+clarity+color+growthType valid.
- Step 2 `quantity-details`: unit type (Carat/Pieces) `onUnitTypeChange`; add/remove size rows (`addSizeRow` max 10, `removeSizeRow`); reference image drag/drop/upload (`onFileChange`/`handleFiles`/`removeFile`/`removeExistingImage` png/jpg); note delete.
- Step 3 `request-preview`: review then Submit Request → uploads image (`meleeRequestService.uploadImage`) then `addRequest`/`updateRequest` → emits `requestSaved`.

---

## 4. Matching Pair
Route: `/buyer/match-pair/:productId` (`MatchingPairComponent`)
Files: `src/app/pages/buyer/matching-pair/matching-pair.component.html`, `.ts`
Sub: `pair-body`, `price-data-wrapper`, `pair-footer`, `no-match-pair`, common `app-pagination`, `app-share-stone` dialog.

| Element/Button | Selector | Handler | Action/Result |
|---|---|---|---|
| Add to Cart / Remove from Cart (per column, pair-footer) | animated button | `handleCartAction($event,product)` | Add/remove cart, cart popover |
| Unavailable | disabled | — | Disabled |
| Wishlist (pair-body) | heart | `addToWishlist`/`removeFromWishlist` | Toggle wishlist |
| Pagination | `app-pagination` | `onPageChange($event)` | Loads similar products page (cached) |
| No match "Back to catalog" (`no-match-pair`) | button | `onBrowseAllDiamonds()` | Back to catalog |

Flow: land from products/detail → selected stone + recommended matches compared → add matches to cart / wishlist → paginate.

---

## 5. Cart / Checkout
Route: `/buyer/cart` (`CartComponent`); order success `/buyer/order-success`.
Files: `src/app/pages/buyer/cart/cart.component.html`, `.ts`; sub: `cart-and-notes`, `delivery-options`, `order-review`, `order-summary`, `cart-item` (+ lgd-detail, melee-detail), `cart-popover`, `order-success`.

3-step stepper via `cartService.activeStep()`: `0`=Cart, `1`=Delivery, `2`=Review. Right column `app-order-summary` drives navigation.

### Order Summary (`order-summary`)
| Element/Button | Selector (text) | Handler | Action/Result |
|---|---|---|---|
| Terms checkbox (step2) | `p-checkbox` "I accept…Terms" | `termsChange.emit($event.checked)` | Enables place order |
| CTA button | "Continue to Delivery Address"/"Continue to Review Order"/"Place order" | `stepperClick.emit()`→`stepperUpdate()` | Advance step or `placeOrder()` |

`isButtonDisabled`: step3, total=0, step2 without terms, or step≠0 without delivery option. Totals: subtotal, GST (India), shipping (non-India), total.

### Cart & Notes (step 0, `cart-and-notes`)
| Element/Button | Selector (text) | Handler | Action/Result |
|---|---|---|---|
| Download | button "Download" | `downloadCart()` | `cartService.downloadCart()` CSV, toast |
| QC requirement input | `.cart-and-notes-qc-input` | edit via `.ph-pencil-simple`, blur→`saveQcNotes` | Updates `defaultQcRequirements` on cart items |
| Select All | `p-checkbox` | `toggleSelectAll($event)` | Select/deselect all cart items |
| Delete All | button "Delete All" | `deleteAll()` | Sequential remove selected; empty→ `/buyer/products` |
| Cart item remove | (cart-item) | `removeFromCart(id)` | `productService.removeFromCart(id)` |

### Cart Item (`cart-item`)
| Element/Button | Selector (text) | Handler | Action/Result |
|---|---|---|---|
| Item checkbox | `p-checkbox` | `toggleSelection($event)` | Toggle `selected` |
| Move to wishlist | heart btn | `moveToWishlist()` | Toggle wishlist; melee via `addMeleeToWishlist` |
| Remove | trash btn | `removeItem()` | Emits `remove` |
| Add/Edit/Delete note (LGD) | note-toggle/save/delete | `noteExpanded`, `saveNote()`, `deleteNote()`, `editNote()` | `cartService.updateCustomerReference` |

### Delivery Options (step 1, `delivery-options`)
| Element/Button | Selector | Handler | Action/Result |
|---|---|---|---|
| Address card | `.address-card` | `onAddressSelect(address)` | Sets shipping address, fetches shipping rate (`lookupService.fetchShippingData`) |

Loads addresses via `checkoutService.getAddress('shipping')`; default first.

### Order Review (step 2, `order-review`)
Read-only cart items grouped Melee/LGD via `app-cart-item` (no actions). "Place order" (order-summary) → `cart.placeOrder()`:
- KYC check (blocks if unverified),
- unavailable SKU check,
- builds billing+shipping address,
- `checkoutService.placeOrder(orderData)` → clears cart → `/buyer/order-success`.

### Order Success (`order-success`)
"Back to Catalog" → `goToCatalog()` → `/buyer/products`.

### Cart popover drawer (`cart-popover`, global)
| Element/Button | Selector (text) | Handler | Action/Result |
|---|---|---|---|
| Close | `.ph-x` | `close()` | Close drawer |
| Item remove | (cart-popover-item) | `removeItem($event)` | Remove from cart |
| Proceed to Checkout | button | `viewCart()` | → `/buyer/cart` |
| Back to Catalog (empty) | button | `backToCatalog()` | → `/buyer/products` |

### Flows
1. Cart → review items/notes → Continue to Delivery → select address → Continue to Review → accept terms → Place order → order success.
2. Move cart item to wishlist / delete items / download cart CSV.

---

## 6. Wishlist
Route: `/buyer/wishlist` (`WishlistComponent` → `app-wishlist-item`)
Files: `src/app/pages/buyer/wishlist/wishlist.component.html`, `.ts`; sub: `wishlist-item`, `wishlist-certified-item`, `wishlist-noncert-item`, skeletons.

### Wishlist Item container (`wishlist-item`)
| Element/Button | Selector (text) | Handler | Action/Result |
|---|---|---|---|
| Lab type tabs | "Lab Grown Diamond"/"Lab Grown Melee" (Natural disabled) | `selectedLabType.set(value)` | Switch certified/noncert table |
| Search input | placeholder "Search by shape, carat, etc" | `searchText.set` | Filters `filteredWishlistData` |
| Add to cart | `p-button` "Add to cart" (disabled unless selection) | `addAllToCart($event)` | Bulk add selected → cart |
| Explore Diamonds (empty) | button | `router.navigate([...])` | → `/buyer/products` or `/buyer/products/melee` |

### Certified table (`wishlist-certified-item`)
| Element/Button | Selector | Handler | Action/Result |
|---|---|---|---|
| Select-all / row checkbox | `p-checkbox` | `handleAllCheckboxChange`/`handleCheckboxChange` | Select rows |
| Size sort | `th` "Size" | `onSort('weight')` | Toggle sort |
| Title/media | row | `navigateToProductDetail(id)` | → product detail |
| Copy stock ID | `.ph-copy` | `helperService.copyToClipboard` | Copy |
| Remove (trash) | `.ph-trash` | `removeProductsFromWishlist(id)` | `wishlistService.removeWishlistProduct` |
| Add all to cart (via parent) | — | `addAllToCart(event)` | `productService.addToCart(products, wishlistId)`, cart popover |

### Noncert (melee) table (`wishlist-noncert-item`)
Same checkbox/remove pattern (`removeWishlistProduct(id,'MELEE')`). `addAllToCart` builds melee items → `productService.addMeleeToCart`. Includes `app-melee-selection-popup` (`handleMeleeAddToCart`/`handleMeleeAddToWishlist`).

Flow: choose lab type → search → select items → Add to cart (bulk) / remove / navigate to detail.

---

## 7. Orders
Route: `/buyer/orders` (`OrdersComponent`)
Files: `src/app/pages/buyer/orders/orders.component.html`, `.ts`; sub: `orders-skeleton`, `utr-verification-modal`, `order-detail` (+ pay-now, payment-result).

| Element/Button | Selector (text) | Handler | Action/Result |
|---|---|---|---|
| Search invoice | input "Search by invoice number" | `onSearchChange()` (500ms debounce) | Refetch invoices |
| Status filter | `p-multiselect` "Status" | `applyFilter()` | Filter by status list |
| Date range | `p-datepicker` range | `onDateRangeSelect()`, `onClearDateRange` | Filter by date |
| Invoice link | `a[routerLink]` invoiceNumber (not for Cancelled) | routerLink | → `/buyer/orders/:invoiceNumber` |
| Payment Pending badge | button "Payment Pending" | `openUtrModal(invoice,$event)` | If utrNumber → opens UTR verification modal |
| Sortable columns | createdAt/deliveryDate/invoiceAmount | `onSort($event)` | Sort |
| Pagination | `app-pagination` | `onPageChange($event)` | Page fetch |
| Explore Diamonds (empty) | `a[routerLink="/buyer/products"]` | — | → products |

Statuses rendered: Payment Pending, Payment Completed, Cancelled, Order Received, Confirmation Pending, Order Confirmed, Availability Check, In QC Process, Dispatched, Order Completed.

Flow: search/filter/sort orders → open invoice detail; if payment pending with UTR → view UTR verification.

---

## 7a. Order Detail
Route: `/buyer/orders/:id` (`OrderDetailComponent`)
Files: `src/app/pages/buyer/orders/order-detail/order-detail.component.html`, `.ts`

| Element/Button | Selector (text) | Handler | Action/Result |
|---|---|---|---|
| Go back | `p[routerLink=backLink()]` | routerLink | → `/buyer/orders` (or `/buyer/buyback` if `pageName=buyback-order`) |
| Copy SKU/lab | `.ph-copy` | `copyToClipboard(...)` | Copy |
| View/Show Diamond Details | toggle | `toggleDiamondDetails(item.id)` | Expand specs/notes (`app-diamond-specifications`) |
| Total Parcels (melee) | button | `parcelsPopover.toggle($event)` | Popover parcel breakdown |
| Voucher input | input "Enter Voucher Code" (payment pending) | `voucherCode.set`, enter→`applyVoucher()` | `orderService.previewVoucher` preview |
| Apply voucher | button "Apply" (disabled unless `canApplyVoucher`) | `applyVoucher()` | Preview discount |
| Pay Now | button "Pay Now" (payment pending + online gateway) | `visible.set(true)` | Opens `app-pay-now` |

Order summary computes subtotal, GST (India), shipping (non-India), voucher discount, total (`summary()`). `app-pay-now` and `app-utr-verification-modal` embedded. `onPaymentSuccess` re-fetches order; online→success modal, bank→UTR modal.

Flow: view order → expand diamond details → apply voucher → Pay Now → payment / UTR submission → download invoice (via orders list `getInvoiceUrl`/`viewOrDownload`).

---

## 7b. Pay Now dialog
Files: `src/app/pages/buyer/orders/order-detail/pay-now/pay-now.component.html`, `.ts`

Step 1 payment method; Step 2 bank transfer.
| Element/Button | Selector (text) | Handler | Action/Result |
|---|---|---|---|
| Payment option | option cards (Card/UPI or Card/ACH, Bank Transfers, Payment Terms disabled) | `onPaymentSelect(value)` | Select method (bank hidden for USA) |
| Cancel | button | `onVisibleChange(false)` | Close |
| Confirm Payment Method | button (disabled unless method≠terms) | `confirmPaymentMethod()` | online→`proceedToPayment()`; bank→step2 + `fetchBankDetails` |
| Copy bank field | `.ph-copy` | `copyToClipboard(value,key)` | Copy bank detail |
| UTR/TXID input | input | `onUtrInput($event)` | Uppercased, validated `^[A-Z0-9]{5,30}$` |
| Go Back | button | `goBack()` | step1 |
| Submit UTR/TXID & Confirm | button (disabled unless valid UTR & !processing) | `onPayNow()`→`submitBankTransferUTR()` | `paymentService.submitBankTransferUTR`, emits paymentSuccess bank_transfer |
| (online) proceed | — | `proceedToPayment()` | `createPaymentRequest` → Stripe redirect or PayU form POST |

## 7c. UTR Verification Modal
Files: `src/app/pages/buyer/orders/utr-verification-modal/utr-verification-modal.component.html`, `.ts`
- View Full UTR/TxID → `showFullUtr.set(true)` (unmasks `maskedUtr`)
- "Okay, Got It!" → `close()` → emits `visibleChange(false)`
- Shows India→UTR / else→TXID via `isIndia`.

## 7d. Payment Result
Routes: `/buyer/payment/success` | `/failure` | `/cancel` (`PaymentResultComponent`, data `type`)
Files: `src/app/pages/buyer/orders/order-detail/payment-result/payment-result.component.html`, `.ts`
- Primary action: success→`goToHome()` (→ /buyer/products); failed→`retryPayment()`; cancel→`continuePayment()` (→ /buyer/orders/:invoice).
- "Continue Shopping" link `href="/buyer"`. Reads `?invoice=` to fetch order details.

---

## 8. Requests
Route: `/buyer/requests` (`RequestsComponent`)
Files: `src/app/pages/buyer/requests/requests.component.html`, `.ts`; sub: `requests-skeleton`, `view-request`.

| Element/Button | Selector (text) | Handler | Action/Result |
|---|---|---|---|
| Search | input "Search by request number" (`searchForm.search`) | valueChanges (debounce) | Refetch |
| Status filter | `p-select` "Status" (confirmed/pending/quoted/order_placed/cancelled) | valueChanges | Filter |
| Date range | `p-datepicker` | `onDateRangeSelect`/`onClearDateRange` | Filter |
| Copy request number | `.ph-copy` | `helperService.copyToClipboard` | Copy |
| View | `a[routerLink]` "View" | routerLink `rowData.id` | → `/buyer/requests/:id` |
| Sort (Date Requested) | `pSortableColumn` | `onSort($event)` | Sort |
| Pagination | `app-pagination` | `onPageChange($event)` | Page |

Search form: `search` (required), `status`, `date`.

## 8a. View Request
Route: `/buyer/requests/:id` (`ViewRequestComponent`)
Files: `src/app/pages/buyer/requests/view-request/view-request.component.html`, `.ts`

| Element/Button | Selector (text) | Handler | Action/Result |
|---|---|---|---|
| Back to My Requests | `a[routerLink]` | routerLink | → `/buyer/requests` |
| Copy request number | `.ph-copy` | `helperService.copyToClipboard(...)` | Copy |
| Edit Request | button "Edit Request" (if editable) | `showRequestModal.set(true)` | Opens `app-make-request` (edit) |
| Cancel Request | button (pending/quoted, canCancel) | `cancelVisible.set(true)` | Cancel confirm dialog |
| Add to cart | button (canAddToCart/order_placed; disabled if in cart/placed) | `onClickAddToCart($event)` | `meleeRequestService.addToCart`, refresh cart, popover |
| Confirm Quotation | button (canConfirmQuotation) | `onClickConfirm()` | Confirm dialog |
| Total Parcels | button | `parcelsPopover.toggle($event)` | Parcel popover |
| Cancel dialog: Keep/Cancel Request | buttons | `cancelVisible.set(false)` / `onClickCancelRequest()` | `meleeRequestService.cancelRequest` → `/buyer/requests` |
| Confirm dialog: Cancel/Confirm Quotation | buttons | `confirmVisible.set(false)` / `confirmQuotation()` | `confirmRequestQuotation` |
| Edit success "Done" | button | `onEditDone()` | Close success dialog |

Flow: view request → edit (make-request dialog) / cancel / confirm quotation / add quoted item to cart.

---

## 9. Buyback
Route: `/buyer/buyback` (`BuybackComponent`, `?type=buyback-order|buyback-request`)
Files: `src/app/pages/buyer/buyback/buyback.component.html`, `.ts`; sub: `buyback-order`, `buyback-request`, `how-to-ship`, skeletons.

### Container
| Element/Button | Selector (text) | Handler | Action/Result |
|---|---|---|---|
| Learn more about shipping | link | `buybackService.showShipModal.set(true)` | Opens How-to-Ship dialog |
| Tabs | "Buyback Order List"/"My Buy Back Requests" | `onTabChange(value)` | Switch tab + query param |
| Search | input "Search by order ID, invoice number" (`searchForm.search`) | valueChanges | Filter |
| Status filter (request tab) | `p-select` (All/Buyback Initiated/Voucher Created/Product Shipped/Delivered/Cancelled) | valueChanges | Filter |
| Make Buy Back Request (order tab) | `p-button` (disabled if no selection) | `onReturnStone()` | `drawerVisible.set(true)` |

### Buyback Order tab (`buyback-order`)
| Element/Button | Selector | Handler | Action/Result |
|---|---|---|---|
| Select-all / row checkbox | `p-checkbox` | `onSelectAll`/`onOrderToggle` | Select orders for buyback |
| Invoice number | `td[click]` | `onClickInvoice(invoiceNumber)` | → `/buyer/orders/:invoiceNumber?pageName=buyback-order` |
| Sort | invoiceDate / deliveryDate columns | `onSort($event)` | Sort |
| Pagination | `app-pagination` | `onPageChange` | Page |
| Drawer: Confirm Buy Back | button | `onReturnStone()` | `confirmVisible.set(true)` |
| Drawer: Cancel / copy SKU | button / `.ph-copy` | close / `copySku` | — |
| Confirm dialog: Yes, Confirm | button | `onConfirmReturn()` | `createBuybackRequest()`, success dialog |
| Success dialog: Okay/Learn shipping | buttons | `onSuccessDialogClose()` / `showShipModal.set(true)` | Close / ship guide |

### Buyback Request tab (`buyback-request`)
| Element/Button | Selector (text) | Handler | Action/Result |
|---|---|---|---|
| Request ID | `td[click]` | `onClickRequestId(product)` | Opens items drawer |
| Add Courier Details | `.add-courier-btn` | `onAddCourier(product)` | Opens courier dialog |
| Cancel Request | `.request-cancel-btn` | `onCancel(id)` | Cancel confirm dialog |
| Courier dialog: Confirm | button | `onConfirmCourier()` | `addShipmentDetails` (validates courier company + shipment number required) |
| Cancel dialog: Keep/Yes Cancel | buttons | `showCancelModal.set(null)` / `onClickCancelYes()` | `cancelRequest()` |
| Pagination | `app-pagination` | `onPageChange` | Page |

Courier form fields: Courier Company (required), Shipment Number (required).

### How-to-Ship dialog (`how-to-ship`)
Close ✕ → `showShipModal.set(false)`. Static shipping instructions; India/USA address by `countryCode`.

Flow: select eligible orders → Make Buy Back Request → confirm → success → (request tab) add courier details / cancel / track status.

---

## 10. My Account (settings)
Route: `/buyer/my-account` (`MyAccountComponent`, children)
Files: `src/app/pages/buyer/my-account/my-account.component.html`; sidebar `sidebar-links`; router-outlet children.

### Sidebar (`sidebar-links`)
Links: Personal Settings (`/buyer/my-account`), Change Currency (`/currency`), Communication (disabled/coming soon), Change Password (`/password`), Shipping Destinations (`/address`), Delete Account (`/delete`), Logout (`/logout`). Theme dropdown `onThemeChange()` → `layoutService.toggleTheme()`.

### Personal Settings (default child)
Form `personalSettingForm`: `firstName` (required, no-whitespace, max50, single-word), `lastName` (required, no-whitespace, max50), `email` (disabled), `mobileNumber` (disabled).
- Cancel (disabled unless dirty+changes) → `onCancel()` resets
- Save Changes (disabled unless valid+changes) → `onSave()` → `updatePersonalSetting`, toast.

### Change Currency (`/currency`)
- Currency row click → `selectCurrency(currency)`
- Cancel → `onCancel()`; Change Currency → `onCurrencyChange()` → `changeCurrency`, updates `userService.currency`, toast (both disabled when unchanged).

### Change Password (`/password`)
Form `resetPasswordForm`: `currentPassword` (required), `password` (required, passwordValidator), `confirmPassword` (required, passwordValidator); validators `confirmedValidator` + `sameAsOld`.
- Cancel (disabled unless has value) → `onCancel()`
- Save New Password (disabled unless valid) → `onSavePassword()` → `changePassword`, server error sets `currentPassword` error.

### Delete Account (`/delete`, `?type=`)
- Delete Account → `showConfirmDialog=true`
- Confirm dialog: "No, Keep my account" → close; "Delete my account" → `onDeleteAccount()` → `softDeleteUser` → logout; if orders in progress → `?type=order_processing_alert` (Contact Support → `/contact-us`).

### Logout (`/logout`)
- Log Out button → `logout()` → `authService.logout()`.

### Address (`/address`, children: `''`, `add`, `update/:id`)
Address list (`adress-list`):
| Element/Button | Selector (text) | Handler | Action/Result |
|---|---|---|---|
| Add Address | `a[routerLink="add"]` | routerLink | → add-address |
| Row menu | `.ph-dots-three-vertical` | `openMenu($event,address,menu)` | Popover |
| Edit Address | popover btn | `onClickUpdate(id,menu)` | → `/buyer/my-account/address/update/:id` |
| Change to Registered Address | popover btn | `openChangeDefaultModal(...)` | Modal → `confirmChangeDefault()` (`changeDefaultAddress`) |
| Delete Address | popover btn | `openDeleteModal(...)` | Modal → `confirmDelete()` (`deleteAddress`) |

Add/Edit address (`add-address`):
Form `addressForm`: `countryId` (disabled, required), `cityId` (required), `stateId` (required), `pincode` (required, `onlyNumberWithLength(5,6)`), `addressLine1` (required, no-whitespace, max200), `addressLine2` (max200), `label` (max50). Country change→`getStates`; state change→`getCities`.
- Cancel → `onCancel()` → `/buyer/my-account/address`
- Save (disabled unless valid) → `onSave()` → `addShippingAddress` or `updateShippingAddress` → back to list, toast.

---

## 11. FAQ (buyer)
Route: `/buyer/faq` (`BuyerFaqComponent`)
- Back to Catalog → `goBackToCatalog()` → `/buyer/products`. Renders common `app-faq-section`.

---

## 12. API Exposure / Resource
Parent route: `/buyer/resource` (`ResourceComponent`), redirect → `overview`. Children: `overview`, `setup`, `markups`, `shopify-guide`, `installation-guide`, `faq`.
Files under `src/app/pages/buyer/api-exposure/`.

### Overview (`/resource/overview`)
Links (routerLink): "Get Started with Shopify" → `/resource/setup?tab=shopify`; feed-type CTAs → `/resource/setup?tab=<tab>`; "Shopify Plugin Guide" → `/resource/shopify-guide?from=overview`. Static content otherwise.

### Set Up (`/resource/setup?tab=`)
Tabs: Data Feeds / Shopify Plugin / API Integration (`activeTab = tab.key`; `?tab=` presets).
- Data Feeds: "Coming Soon" static.
- Shopify Plugin: "Get Augmont Connect" button (no handler); "Shopify Plugin Guide" link → `/resource/shopify-guide?from=shopify`.
- API Integration: "See Technical Documentation" (`apiDocumentUrl`); Staging "See/Hide Credentials" → `toggleCredentials()` (`loadCredentials` → `getBuyerConfiguration`); Production toggle → `toggleProductionCredentials()`; password eye toggles; Help links → API docs, `/resource/installation-guide`, `/resource/faq`.

### Markup % (`/resource/markups`)
Form (FormArray `rows` of `{minPrice(read-only), maxPrice, markupPercent}`).
| Element/Button | Selector (text) | Handler | Action/Result |
|---|---|---|---|
| Markup enable switch | `p-toggleswitch` | `onToggleMarkup()` | `markupsService.toggleMarkupsEnabled` |
| By Price / By Carat | `.markup-mode-btn` | `markupsService.switchMode('price'|'carat')` | Mode toggle |
| Reset to Default | button (disabled unless `canResetToDefault`) | `resetToDefault()` | Reset rows |
| Add Row | button (disabled if rows invalid) | `addRow()` | Add markup range |
| Delete row | `.markup-trash` | `removeRow(i)` | Remove row |
| maxPrice / markupPercent | `p-inputNumber` | reactive form | Validated (markupTooHigh >200%, required) |
| Apply Changes | button (disabled unless `canApplyChanges` & valid) | `applyChanges()` | `saveMerchantMarkups`, toast |

### Installation Guide (`/resource/installation-guide`)
- Go Back → `navigateBack()` → `/resource/setup?tab=api`
- Download PDF → `downloadApiPdf()` (downloads `API Understanding Guide.pdf`). Static swagger/error-code tables.

### Shopify Guide (`/resource/shopify-guide?from=`)
- Go Back → `navigateBack()` → `/resource/setup?tab=shopify` (if `from=shopify`) else `/resource/overview`
- FAQ accordion toggle → `toggle(faq)`; answer links → `handleAnswerClick`.

### API FAQ (`/resource/faq`)
- Go Back → `navigateBack()` → `/resource/setup?tab=api`
- Accordion toggle → `toggle(faq)`. Static FAQ list.

---

## Share Stone dialog (used by Products, Product Detail, Matching Pair)
Files: `src/app/pages/buyer/products/share-stone/share-stone.component.html`, `.ts` (+ `customize-details-dialog`, `markup-center` + `range-form`)
| Element/Button | Selector (text) | Handler | Action/Result |
|---|---|---|---|
| Close | button `pi-times` | `onClickClose()` | Reset + close |
| Recipient email (email mode) | `input#email` (required, email) | ngModel `recipientEmail` | Validated |
| Include price switch | `p-toggleSwitch` | ngModel `isIncludePrice` | Toggle price in message |
| Markup type | radio "one-off" / "center" | `selectedMarkUpType` | One-off input vs Markup Center |
| One-off markup | `p-inputNumber` %+final price | `onMarkUpChange()` | Error if >200% |
| Customize shared details | `app-customize-details-dialog` | `saveCustomization($event)` | Config which fields shared |
| Share to WhatsApp | button | `shareToWhatsApp()` | Builds message, opens wa.me, analytics |
| Share via Mail | button (disabled if invalid) | `shareToEmail()` | `sendStoneEmail`, toast |

Live WhatsApp/Email preview panel rendered from `getWhatsAppMessageJsonByField()`.

---

### Cross-cutting notes for test generation (buyer)
- Add-to-cart everywhere sets `productService.cartPopoverEvent` → the global right-side cart drawer (`app-cart-popover`) opens; "Proceed to Checkout" → `/buyer/cart`.
- Wishlist toggles update `userService.wishlistAllProducts` / `wishlist` count; heart icon fills (`ph-fill ph-heart text-error-dark`).
- Currency second line appears only when `userService.currency().currencyCode !== 'USD'`.
- Melee items use `lineType==='MELEE'`; LGD default. Selection popup required for melee cart/wishlist (quantity in carat/pieces).
- Toasts via `helperService.showMessage`; PrimeNG `p-dialog`/`p-drawer`/`p-popover`/`p-select`/`p-multiselect`/`p-datepicker`/`p-checkbox`/`p-toggleSwitch`/`p-inputNumber` are the interactive primitives (target by role/label/text for Playwright).

---

# SECTION: Admin & Seller Pages Reference

Route files: `src/app/routes/admin.routes.ts`, `src/app/routes/seller.routes.ts`
All admin routes are under `AuthorizedComponent`, guarded by `authGuard`, `data: { excludeRoles: ['buyer','seller'] }`. Buttons are permission-gated via `ability.can(action, subject)` (`AuthService.ability()`), so elements may not render if the logged-in user lacks the permission.

Reusable components used across several pages:
- `app-admin-page-header` (title, date-range picker, search box, status filter, tabs, action button) — emits `dateRangeChange`, `searchChange`, `statusChange`, `tabChange`, `actionButtonClick`, `clearDateRange`.
- `app-admin-page-content` (loading/empty/pagination wrapper) — emits `pageChange`.
- `app-admin-table` (config-driven table; row action menu) — emits `sortChange`, `actionClick` (`{action,row}`), `chipClick`, `linkClick`.
- `app-confirmation-dialog` (`#confirmationDialog`, `.show()`/`.hide()`) — emits `confirm`, `cancel`.

---

## 1. Admin Home
Route: `/admin` — files: `src/app/pages/admin/home/home.component.{html,ts}`

Static dashboard. Only a "Quick Stats" card with text "Welcome to the admin dashboard". No buttons, no handlers, no forms.

---

## 2. Sellers
Route: `/admin/sellers` — files: `src/app/pages/admin/sellers/sellers.component.{html,ts}`
Child routes: `create-seller`, `update-seller/:id` (both → `OnboardSellerComponent`), `bulk-update-margin` (`BulkUpdateMarginComponent`).

| Element/Button | Selector (id/class/text) | Handler | Action/Result |
|---|---|---|---|
| Search input | `input[formControlName=search]` in `searchForm` | `sanitizeSearchInput($event)` | Debounced (300ms) seller list filter |
| Country filter | `p-select[formControlName=countryCode]` | valueChanges | Filters sellers by country |
| Status filter | `p-select[formControlName=status]`, options Active(`completed`)/Inactive(`incomplete`) | valueChanges | Filters by profile status |
| Add Seller | `a[routerLink=create-seller]` text "Add Seller"; perm `createSeller`/"Create Seller" | routerLink | Navigates to onboard seller |
| Bulk Update | `a[routerLink=bulk-update-margin]` text "Bulk Update"; perm `updateBulkMargin` | routerLink | Navigates to bulk margin update |
| Default margin widget | `app-admin-seller-default-margin`; perm `viewDefaultMargin`/`updateDefaultMargin` | — | View/update default margin |
| Profile status toggle | `p-toggleSwitch` (per row); perm `updateSellerStatus` | `toggleActive(seller,$event)` | Opens confirm dialog; on confirm calls `updateProfileStatus` (completed/incomplete) |
| Expand row chevron | `button` with `pi-chevron-up` | `toggleRow(seller,$event)` | Expands margin editor panel |
| Edit seller | `a[routerLink=['update-seller', seller.id]]` pencil icon; perm `updateSeller` | routerLink | Edit seller page |
| Margin type tabs | `p-tabs` (Lab Grown Diamonds=`margin`, Lab Grown Melee=`nonCertMargin`) | — | Switch margin dataset |
| Add Margin | `p-button` label "Add Margin"; perm `addMargin`/"Set Margin" | `addNewMargin(seller, marginType)` | Requires country selected; posts `updateMargin` |
| Save (margin) | `p-button.saveMarginBtn` label "Save" | `saveMarginData(sellerId, margin, marginType)` | `updateMargin` API; toast on success |
| Margin inputs | `p-inputnumber` bound to customDuty/commission/additionalCommission; `p-toggleSwitch` isActive | ngModel | Editable when `canAddMargin`/`canViewAllMargin` else `***` |
| Paginator | `p-paginator` | `changePage($event)` | pageSize 10 |
| Confirm dialog | `app-confirmation-dialog #confirmationDialog` header "Confirm Profile Status Change" | `onConfirmToggle()` / `onCancelToggle()` | Confirms enable/disable seller |
| Add buyer/seller modal | `app-add-buyer-seller #addBuyerSeller` | `onSellerAdded($event)` | `addSeller` API |

Key services: `AdminBuyerService.fetchAllSellers`, `AdminSellerService.addSeller/updateMargin/updateProfileStatus/uploadInventory`.

**Flow — Enable/Disable a seller:**
1. On a seller row, toggle the Profile Status switch → `toggleActive` records pending change and opens confirm dialog.
2. Dialog shows disable-warning or enable-confirm text based on current `profileStatus`.
3. Click "Update" → `onConfirmToggle` calls `updateProfileStatus(id,{profileStatus:'completed'|'incomplete'})`.
4. Expected: success toast "Profile status updated to complete/incomplete successfully"; toggle reflects new state. Cancel reverts pending change.

**Flow — Add margin for a seller:**
1. Expand a seller row (chevron), select margin type tab.
2. If empty, select country, enter tarif/commission/additional, toggle active, click "Add Margin".
3. Expected: validation error toast if no country; otherwise `updateMargin` posted; success toast "Margin updated successfully".

---

## 3. Buyers
Route: `/admin/buyers` — files: `src/app/pages/admin/buyers/buyers.component.{html,ts}`
Child: `add-buyer` modal (`AddBuyerComponent` with `personal-details`, `company-details` sub-forms), `edit-api-expose` (`EditApiExposeComponent`).

| Element/Button | Selector (id/class/text) | Handler | Action/Result |
|---|---|---|---|
| Country switch | `p-selectButton` (IND/US/etc, flags) | `onCountryChange($event)` | Reload buyers for country; clears cache |
| Total count | text "Total {country} Buyers:" | — | Shows `totalRecords()` |
| Search | `input[pInputText]` ngModel `searchTerm` | `sanitizeSearchInput` → `onSearchChange` | Debounced list filter |
| Status filter | `p-select` options Active(true)/Inactive(false) | `onStatusChange($event)` | Filter by isActive |
| Add Buyer | `button` text "Add Buyer" icon `pi-user-plus`; perm `addBuyer` | `addBuyer.show(); addBuyerForm()` | Opens add-buyer modal (multi-step) |
| Row actions menu | `button` `pi-ellipsis-v` | `op.toggle($event)` | Opens popover |
| View Details | popover button "View Details" | `viewDetails(buyer)` | Loads buyer, opens modal read-only |
| Edit Details | popover button "Edit Details"; perm `updateBuyer` | `editDetails(buyer)` | Opens modal in edit mode |
| Active toggle | `p-toggleSwitch`; perm `changeBuyerStatus` | `toggleActive(buyer)` | `changeBuyerStatus(id, !isActive)` |
| View Audit Log | popover button "View Audit Log" | `viewAuditLog(buyer)` | (console log only — no-op) |
| Prod Api Expose | popover button "Prod Api Expose"; perm `prodiApiAutoOrderAddress` | `onClickApiExpose(buyer)` | Opens `app-edit-api-expose` dialog |
| Tax/Account badges | `span.gstin-badge`/`.profile-badge` | `getStatusBadgeConfig` | Verified/Manual/Pending/Failed with tooltip reason |
| Paginator | `p-paginator` | `changePage($event)` | pageSize 10; 5-min cache |
| Add Buyer modal | `app-add-buyer #addBuyer` | `onBuyerAdded($event)` | add or update via `addBuyer`/`updateBuyer` |

**Flow — Add a buyer:** click Add Buyer → modal opens (steps: personal details, company details) → submit → `onBuyerAdded` transforms & posts `addBuyer`; success toast "Buyer added successfully"; list reloads.
**Flow — Change buyer status:** open row menu → toggle Active → `changeBuyerStatus` API → toast "Buyer status changed successfully".

---

## 4. Orders
Route: `/admin/orders` — files: `src/app/pages/admin/orders/orders.component.{html,ts}`. Detail: `/admin/orders/:id`; recommendation: `/admin/orders/:id/stone-recommendation`.
Uses `app-admin-page-header` + `app-admin-table`.

| Element/Button | Selector/Config | Handler | Action/Result |
|---|---|---|---|
| Tabs | header tabs: Actual Orders(`actual`) / Test Orders(`test`) | `onTabChange($event)` | Sets `?tab=`, reloads; test tab shows delete action |
| Date range picker | header date picker `createdAt` | `onDateRangeChange()` / `clearDateRange` | Filter by start/end date |
| Search | header search `search` | `onSearchChange()` | Debounced order search |
| Trigger Payment chip | table column `triggerPayment` chip "Trigger Payment"; perm `triggerPaymentPendingNotification` | `onChipClick`→`triggerPaymentNotification(row)` | Shown when status "payment pending"; sends payment-pending notification |
| View Details (row) | action `getOrderByInvoiceNumber`, icon `ph-pencil` | `onTableAction` | Navigate to `/admin/orders/{invoiceNumber}` (carries date & tab) |
| Delete (row) | action `deleteOrder`, icon `ph-trash`, visible only `row.isTestOrder` | `onTableAction`→`deleteOrder(row)` | Opens delete dialog |
| Delete dialog Yes | `p-dialog` "Order Delete" button "Yes" | `onConfirmDelete()` | `deleteOrder(id)`; toast; note "impacts invoice amount" |
| Delete dialog No | button "No" | `showDeleteDialog.set(false)` | Close |
| Paginator | content pagination [10,20,50,100] | `onPageChange($event)` | — |

Columns: Invoice #, Quantity, Date&Time, Customer Name (`***` if no `viewCustomerDetails`), Billing/Shipping Address (`***` gated), Invoice Status.
Service: `AdminOrdersService.getOrders/deleteOrder/updateOrderStatus/triggerPaymentPendingNotification`.

**Flow — Delete a test order:**
1. Switch to Test Orders tab → each row shows Delete.
2. Click Delete → confirmation dialog.
3. Click Yes → `deleteOrder` API → toast "Order deleted successfully"; list reloads.

**Flow — Trigger payment notification:** on a "payment pending" order, click the "Trigger Payment" chip → `triggerPaymentPendingNotification(invoiceNumber)` → success toast.

### 4b. Order Detail
Route: `/admin/orders/:id` — files: `src/app/pages/admin/orders/order-detail/order-detail.component.{html,ts}`

| Element/Button | Selector/label | Handler | Action/Result |
|---|---|---|---|
| Back | `a` arrow-left icon | `onClickBack()` | Navigate to `/admin/orders` (keeps date/tab) |
| Save | `p-button` "Save"; perm `orderStatusUpdate`; disabled unless `isStatusChanged()` & form valid | `updateOrderStatus()` | Posts `ordersStatus` (+utr/courier/tracking); toast success |
| Download | `p-button` "Download"; perm `downloadOrderDetailsExcel` | `downloadExcel()` | Downloads `{invoice}.xlsx` |
| Master Order Status | `p-select[formControlName=masterOrderStatus]` | `onMasterStatusChange($event)` | Sets allowed transition; toggles UTR/courier requirements |
| UTR field | `input[formControlName=utr]`; shown when `requiresUtr()` | — | Pattern `^[A-Z0-9]{5,30}$` |
| Courier Partner Name | `input[formControlName=courierPartnerName]`; when `requiresCourierTracking()` | — | Pattern letters/space, 2–50 |
| Tracking Number | `input[formControlName=trackingNumber]` | — | Pattern `^[A-Z0-9\-]{5,30}$` |
| Clear | `p-button` "Clear" | `clearForm()` | Reset payment form |
| Per-item status | `p-select` per order line; perm `getAllOrderStatus` | `onStatusChange(item)` | Marks status changed; allowed transitions map |
| Replace Stone | `p-button` "Replace Stone"; perm `replaceOrderProduct`; enabled when status "Not available"/"QC Fail" | `replaceStone(item)` | Opens `app-replace-stone-dialog` |
| Copy SKU | `ph-copy` icon | `copyToClipboard(...)` | Clipboard |
| Vendor Details panel | `p-panel` toggle; perm `viewVendorDetails` | — | Expand vendor info |

Replace-stone dialog (`replace-stone-dialog/`) emits `replaceStone` (→`onReplaceStone` calls `replaceProduct`), `showRecommendation` (→`onShowRecommendation` navigates to stone-recommendation), `manualStoneReplaced`. Prices gated by `viewProductPrice`/`viewOrderAmount`; customer block gated by `viewCustomerDetails`.

**Flow — Change order status (master):** select Master Order Status → fill UTR or courier/tracking if required → Save → `updateOrderStatus` → success toast, detail reloads.
**Flow — Replace a stone:** on QC Fail / Not available line click Replace Stone → dialog → enter identifier or pick recommendation → `replaceProduct(orderId, identifier)` → success toast (original cancelled, new line created).

---

## 5. Requests (Melee)
Route: `/admin/requests` — files: `src/app/pages/admin/request/request.component.{html,ts}`
Guard: redirects to `/admin` if `meleeRequestsView`/"View Requests" not granted.

| Element/Button | Selector (id/class/text) | Handler | Action/Result |
|---|---|---|---|
| Search | `input[formControlName=search]` | valueChanges | Debounced request search |
| Status filter | `p-select[formControlName=status]` (pending/quoted/cancelled/confirmed) | valueChanges | Filter requests |
| Price per Carat input | `p-inputNumber` per size; editable when `canQuoteMeleeRequests` & status pending | ngModel | Enter quote price/carat |
| Location input | `input[pInputText]` ngModel `rowData.location`; when quoting | ngModel | Enter location |
| Send Quotation | `button` "Send Quotation"; perm `meleeRequestsQuote`; disabled if status≠pending | `onClickSendQuotation(rowData)` | Validates location+prices; opens confirm dialog |
| Copy request no | copy icon | `helperService.copyToClipboard` | Clipboard |
| Confirm dialog "Yes, Send" | `p-dialog` button | `confirmSendQuotation()` | `createQuote(id,payload)`; toast "Quote Created Successfully" |
| Confirm dialog "No" / X | button/close icon | `confirmVisible.set(false)` | Close |
| Paginator | `p-paginator` [10,20,50,100] | `onPageChange($event)` | — |

**Flow — Send a quotation:**
1. On a pending request enter price/carat for each parcel and a location.
2. Click Send Quotation → validation (both required, else error toast) → confirm dialog.
3. Click Yes, Send → `createQuote` with lines (parcelId, pricePerCarat), locationLabel → toast success; list reloads.

---

## 6. Buy-Back Requests
Route: `/admin/buy-back-requests` — files: `src/app/pages/admin/buy-back-requests/buy-back-requests.component.{html,ts}`
Two permission-gated tabs: "Discounts of Buyback" (`buybackDiscountsConfig`) and "Buyback Product Request" (`buybackRequest`). `?tab=` synced.

**Discount tab table:**

| Element/Button | Selector | Handler | Action/Result |
|---|---|---|---|
| Carat select | `p-select` caratOptions | ngModel | Row carat |
| Percentage select | `p-select` 1–10% | ngModel | Row fee percent |
| Save row (check) | `pi-check` (unsaved row) | `saveSingleRow(row)` | `createConfig` |
| Confirm edit (check) | `pi-check` (editing) | `updateRow(row)` | `updateConfig(id,...)` |
| Cancel edit | `pi-times` | `cancelEdit(row)` | Reload configs |
| Edit row | `pi-pencil` | `editRow(row)` | Enable edit |
| Delete row | `pi-trash` | `deleteRow(row)` | `deleteConfig(id)` |
| Remove unsaved | `pi-times` | `removeDiscountRow(index)` | Remove draft |
| + Add Row | text "+ Add Row" | `addDiscountRow()` | Append draft |

**Requests tab table:**

| Element/Button | Selector | Handler | Action/Result |
|---|---|---|---|
| Search | `input[pInputText]` signal `searchInput` | ngModelChange | Debounced reload |
| Status dropdown | `p-select.custom-status-dropdown` per row | `updateStatus(raw,$event.value)` | Patch item status; disabled when buyer-owned step or no allowed transitions |
| Send Email | `button` "Send Email"/"Sending…"; only when status "Voucher Created" | `onSendEmail(raw)` | `sendVoucherEmail(id)`; success toast |
| Sortable Request Date | `th[pSortableColumn]` | `customSort` | Sort by createdAt |
| Paginator | `p-paginator` [10,20,50,100] | `onPageChange($event)` | — |

**Return Request (QC Fail) dialog** (opens when selecting QC Fail status):

| Field | Selector | Validator/Notes |
|---|---|---|
| QC Fail Reason | `p-select#return-qc-fail-reason` | Required |
| Courier partner (India) | `p-select#return-courier-partner` (Courier/Angadia) | Required for India |
| Mobile number (Angadia) | `input#return-mobile-number` maxlength 10 | 10-digit numeric (`onlyNumberWithLength(10,10)`) |
| Courier name / Tracking Id (Courier or USA) | `input#return-courier-name-*`, `#return-tracking-id-*` | Required in courier/USA mode |
| Cancel | `p-button` "Cancel" → `closeReturnRequestDialog()` | Close |
| Submit | `p-button` "Submit"; disabled via `returnRequestSubmitBlocked()` → `submitReturnRequest()` | Patch item status w/ QC-fail payload |

Service: `BuyBackRequestService` (listConfigs/createConfig/updateConfig/deleteConfig, listRequests, listStatuses, updateItemStatus, sendVoucherEmail).

**Flow — Process a buyback status change:**
1. Requests tab, open the row status dropdown, select an allowed next status.
2. If QC Fail → Return Request dialog opens; fill reason + courier/angadia fields → Submit → `updateItemStatus` with QC-fail payload → toast "Return request updated successfully".
3. Otherwise → `updateItemStatus({statusId})` directly → toast "Status updated successfully".
4. When status becomes "Voucher Created", Send Email appears → click → `sendVoucherEmail` → success toast.

**Flow — Add discount config:** Discount tab → + Add Row → select carat & percent → click check → `createConfig` → toast "Saved".

---

## 7. All Products
Route: `/admin/all-products` — files: `src/app/pages/admin/admin-all-products/admin-all-products.component.{html,ts}`

| Element/Button | Selector | Handler | Action/Result |
|---|---|---|---|
| Option filter | `p-select` (All/Approved/Unapproved) | `onOptionChange($event)` | Filter by approval status |
| Seller filter | `p-select` filterable by companyName | `onSellerChange($event)` | Filter by seller |
| Search input | `input[pInputText]` value `searchInputValue` | `sanitizeSearchInput`, `onSearchKeyPress` (Enter) | Stage a search term |
| Search button | `p-button` icon `pi-search`; disabled when empty | `onSearchClick()` | Add term pill; reload |
| Clear all | `p-button` "Clear all" | `clearAllFilters()` | Reset filters |
| Remove seller pill | `pi-times-circle` | `removeSellerFilter()` | Remove seller filter |
| Remove term pill | `pi-times-circle` | `removeSearchTerm(term)` | Remove term |
| Copy stock id | `p-button` `pi-copy` | `helperService.copyToClipboard` | Clipboard |
| Expand row | chevron button | `toggleRow(rowData,$event)` | Show details panel |
| Paginator | `p-paginator` [10,20,50,100] | `changePage($event)` | — |

Columns gated: `total`→`totalPrice`, `rawFinalPrice`→`priceByVendor`. Read-only (no approve actions here). Service `AdminProductService.getAllProducts/getSeller`.

---

## 8. Unapproved Products
Route: `/admin/unapproved-products` — files: `src/app/pages/admin/admin-unapproved-products/admin-unapproved-products.component.{html,ts}`

| Element/Button | Selector | Handler | Action/Result |
|---|---|---|---|
| Seller filter | `p-select` filterable, showClear | `onSellerChange($event)` | Filter unapproved by seller |
| Download | `button` icon `pi-download`; perm `downloadUnapprovedCSV`; disabled if no products | `downloadProducts()` | Downloads `products-{date}.csv` |
| Upload | `button` icon `pi-upload`; perm `uploadUnapprovedProducts` | `fileInput.click()` | Opens file picker (.xlsx/.xls/.csv) |
| File input | `input#fileInput type=file` hidden | `onFileSelected($event)` | Opens upload confirm dialog |
| Select-all checkbox | header `p-checkbox` | `handleAllCheckboxChange($event)` | Select/deselect all rows |
| Row checkbox | `p-checkbox` | `handleCheckboxChange($event,row)` | Toggle selection |
| Row approve (⋮) | `button` `pi-ellipsis-v`; perm `approveProducts` | `confirm1($event,row)` | ConfirmPopup → `approveProductByProductId({ids:[id]})` |
| Expand row | chevron | `toggleRow(row,$event)` | Details panel |
| Approve Selected (N) | `button` in hover bar; perm `approveProducts` | `approveSelectedProducts()` | Opens approval dialog (`isApproveAll=false`) |
| Approve All (total) | `button` in hover bar; perm `approveProductsBySeller` | `approveAllProducts()` | Opens approval dialog (`isApproveAll=true`) |
| Upload dialog Upload/Cancel | `p-dialog` "Upload Products" | `handleFileUpload()` / `cancelFileUpload()` | `uploadProducts(file)` |
| Approval dialog Approve/Cancel | `p-dialog` "Confirm Approval" | `handleApproval()` / `visible.set(false)` | Approve by ids or by seller_id |
| Paginator | `p-paginator` [10,20,50,100] | `changePage($event)` | — |

Service: `AdminProductService.getUnapprovedProducts/approveProductByProductId/approveProductBySellerId/downloadProducts/uploadProducts/getSeller`.

**Flow — Approve a single product:** click row ⋮ → ConfirmPopup "Yes, approve" → `approveProductByProductId({ids:[id]})` → toast "Product approved successfully"; list reloads.
**Flow — Approve selected/all:** select rows (or all) → hover bar → Approve Selected/Approve All → confirm dialog Approve → `approveProductByProductId({ids})` or `approveProductBySellerId(sellerId|'all')` → toast; selection cleared, reload.
**Flow — Upload inventory:** Upload → pick file → dialog "Upload" → `uploadProducts` → toast "Products uploaded successfully".

---

## 9. Internal Users
Route: `/admin/internal-users` — files: `src/app/pages/admin/internal-users/internal-users.component.{html,ts}`; add modal: `add-internal-users/`.
Uses `app-admin-page-header` + `app-admin-table` + `app-confirmation-dialog`.

| Element/Button | Selector/Config | Handler | Action/Result |
|---|---|---|---|
| Date range / Search | header | `onDateRangeChange()` / `onSearchChange()` / `clearDateRange` | Filter list |
| Add Internal User | header action button; perm `addInternalUser`/"Create Internal User"; text "Add Internal User" | `openAddDialog()` | Opens add modal |
| Row: View Details | action `read`, subject InternalUser, skipAbilityCheck | `onTableAction`→`onViewDetails` | Modal read-only |
| Row: Edit Details | action `updateInternalUser`/"Update Internal User" | `onEdit` | Modal edit mode |
| Row: Delete User | action `updateInternalUserStatus`/"Delete Internal User" | opens confirm dialog | Confirm → `deleteInternalUser` |
| Confirm delete | `app-confirmation-dialog` "Confirm Deletion" | `deleteInternalUser()` | `updateInternalUserStatus(id)`; toast |
| Paginator | content [5,10,20] | `onPageChange` | — |

**Add/Edit modal form** (`add-internal-users.component`, `internalUserForm`):

| Field | Control | Validators |
|---|---|---|
| First Name | `firstName` input maxlen30 minlen3 | required, `nameFieldValidator` |
| Last Name | `lastName` | required, `nameFieldValidator` |
| Email | `email` maxlen50 | required, `emailValidator`; disabled in edit |
| Country | `countryCode` p-select | required; disabled in edit if set |
| Mobile number | `mobileNumber` maxlen10 (flag+dial code shown) | required, `onlyNumberWithLength(10,10)`; disabled in edit |
| Role | `roleId` p-select (roleName/id) | required |
| User Type | `userTypeId` p-select (name/id) | required |
| ID Number | `idNumber` maxlen30 | `nameFieldValidatorWithNumbers` |
| Cancel / Submit(Update) | `p-button`; Submit disabled if invalid | `onCancel()` / `onSubmit()` — emits `formValueEmit` |

Service: `InternalUsersService.fetchAllInternalUsers/createInternalUser/updateInternalUser/updateInternalUserStatus`. Dropdowns from `UserTypeService`, `RoleService`, countries from `LookupService`.

**Flow — Create internal user:** Add Internal User → fill all required → Submit (`onInternalUserFormSubmitted`) → `createInternalUser` → toast "Internal user created successfully"; modal closes, list reloads. Edit path uses `updateInternalUser`.

---

## 10. Role and Permission
Route: `/admin/roles` — files: `src/app/pages/admin/role-and-permission/role-and-permission.component.{html,ts}`; add modal: `add-role/`.

| Element/Button | Selector/Config | Handler | Action/Result |
|---|---|---|---|
| Date range / Search | header | `onDateRangeChange` / `onSearchChange` | Filter roles |
| Create Role | header action button "Create Role" icon `pi-user-plus` | `openAddDialog()` | Opens add-role modal |
| Role Name (link) | table column `roleName` template `link` | `onTableLinkClick` | Store roleName; navigate `/admin/permission/{id}` |
| Row: View Details | action `view` | `onViewDetails` | Modal read-only |
| Row: Edit Details | action `edit` | `onEdit` | Modal edit |
| Row: Delete Role | action `delete` | opens confirm dialog | `onDelete`→`deleteRole` |
| Confirm delete | `app-confirmation-dialog` "Confirm Deletion" | `onDelete()` | `deleteRole(id)`; toast |
| Paginator | [5,10,20] | `onPageChange` | — |

**Add-role modal** (`add-role.component`, `roleAndPermissionForm`):

| Field | Control | Validators |
|---|---|---|
| Role Name | `roleName` maxlen30 minlen3 | required, `nameFieldValidator` |
| Role Description | `description` textarea maxlen200 (char counter) | sanitized on input |
| Clone Role | `roleId` p-select (clone from existing) | optional |
| Cancel / Submit(Update) | Submit disabled if invalid | `onCancel` / `onSubmit` — emits payload |

Service: `RoleService.fetchAllRoles/createRole/updateRole/deleteRole`.

**Flow — Create role + assign permissions:**
1. Create Role → fill Role Name (+optional clone) → Submit → `createRole` → toast "Role created successfully".
2. Click the role name link → navigates to Add Permission page for that role.

---

## 11. Add Permission
Route: `/admin/permission/:roleId` — files: `src/app/pages/admin/add-permission/add-permission.component.{html,ts}`

| Element/Button | Selector | Handler | Action/Result |
|---|---|---|---|
| Back to Roles | `button[routerLink=/admin/roles]` | routerLink | Navigate back |
| Permission accordion | `p-accordion-panel` per permission group | `onAccordionChange` | Expand/collapse |
| Permission toggle | `p-toggleSwitch` per group | `onPermissionToggle(permission)` | Enable/disable all actions in group |
| Action checkbox | `p-checkbox` per action | `onActionChange(permission, actionId)` | Toggle action; melee view/quote linked dependency |
| Reset | `p-button` "Reset"; disabled if no changes | `onResetPermissions()` | Reload original permissions |
| Save Changes | `p-button` "Save Changes"; disabled if no changes; `[loading]=saving` | `onSavePermissions()` | Validate → `saveRolePermissions`; navigate `/admin/roles`; success toast |

Header shows role name, selected permission/action counts, and "unsaved changes" indicator via `hasChanges()`. Service: `PermissionService.getRolePermissions/saveRolePermissions/validatePermissions`.

**Flow — Assign role permissions:**
1. Page loads permissions for `:roleId` (roleName from local store).
2. Toggle groups / check actions (selecting Melee Quote auto-selects Melee View; unchecking View unchecks Quote).
3. Click Save Changes → validation → `saveRolePermissions` → success toast, navigate to Roles. Reset reverts unsaved changes.

---

## 12. User Type Master
Route: `/admin/user-type-master` — files: `src/app/pages/admin/user-type-master/user-type-master.component.{html,ts}`; add modal: `add-user-type-master/`.

| Element/Button | Selector/Config | Handler | Action/Result |
|---|---|---|---|
| Date range / Search / Status | header | `onDateRangeChange`/`onSearchChange`/`onStatusChange` | Filter list |
| Add User Type | header action button "Add User Type"; perm `createUserType`/"Create User Type" | opens `addUserTypeMaster` in add mode | Opens modal |
| Row: View Details | action `getUserTypeDetails` skipAbilityCheck | `viewDetails` | Modal read-only |
| Row: Edit Details | action `updateUserType`/"Update User Type" | `editDetails` | Modal edit |
| Row: Delete User Type | action `deleteUserType`/"Delete User Type" | opens confirm dialog | `deleteUserType` |
| Confirm delete | `app-confirmation-dialog` "Confirm Deletion" | `deleteUserType()` | `deleteUserType(id)`; toast |
| Paginator | [5,10,20] | `onPageChange` | — |

**Add modal** (`add-user-type-master.component`, `userTypeForm`):

| Field | Control | Validators |
|---|---|---|
| User Type Name | `name` maxlen30 minlen3 | required, `nameFieldValidator` |
| Description | `description` textarea maxlen200 (counter) | optional |
| Cancel / Submit(Update) | Submit disabled if invalid | `onCancel` / `onSave` — emits `userTypeFormSubmitted` |

Service: `UserTypeService.fetchAllUserTypes/addUserType/updateUserType/deleteUserType/getUserTypeById/changeUserTypeStatus`.

**Flow — Create user type:** Add User Type → enter name (+description) → Submit → `addEditUserType`→`addUserType` → toast "User type added successfully"; reload.

---

## 13. Admin Book Demo
Route: `/admin/book-a-demo` — files: `src/app/pages/admin/admin-book-demo/admin-book-demo.component.{html,ts}`
Two permission-gated tabs.

| Element/Button | Selector | Handler | Action/Result |
|---|---|---|---|
| Tab switch | `p-selectButton` (Meetings Schedules=`bookings`, Sales Team=`salesTeam`) | `setTab($event)` | Switch view |
| Add User | `button` "Add User"; salesTeam tab + perm `salesTeamManage` | `addSalesMember()` → `salesTeamRef.startAdd()` | Starts inline add row |

Tabs gated: bookings→`meetingSchedulesView`/"Meeting Schedules"; salesTeam→`salesTeamManage`/"Sales Team".

### 13a. Book Demo Bookings (read-only table)
Files: `book-demo-bookings/book-demo-bookings.component.{html,ts}`. Columns: Full Name, Email, Phone, Meeting Time, Status (Active/Cancelled badge), Sales Person, Message. Paginator `changePage` (pageSize 20). Service `AdminBookDemoService.fetchBookings`. No action buttons.

### 13b. Book Demo Sales Team
Files: `book-demo-sales-team/book-demo-sales-team.component.{html,ts}`

| Element/Button | Selector | Handler | Action/Result |
|---|---|---|---|
| Inline Name/Email/Country/Phone | inputs bound `inlineName/Email/Country/Phone` | ngModel | Add/edit member (email must be `@augmont.com`, phone 10 digits) |
| Save inline (check) | `pi-check` | `saveInline()` | `addSalesPerson`/`updateSalesPerson`; 409 → "Email already exists" |
| Cancel inline | `pi-times` | `cancelEdit()` | Discard |
| Edit | `ph-pencil-simple` | `startEdit(member)` | Enter edit row |
| Delete/Deactivate | `ph-trash` | `promptDelete(member)` | Opens confirm dialog |
| Authorize Calendar | `pi-link` (when Not Authorized) | `authorizeCalendar(member)` | `authorizeCalendar(id)`; sends auth email |
| Confirm Deactivate | `app-confirmation-dialog` "Deactivate Member" | `confirmDelete()` | `deleteSalesPerson(id)`; toast |
| OAuth banner dismiss | `pi-times` | `dismissBanner()` | Hide calendar-auth success banner |

Validators (inline): name required; email required + regex `^[^\s@]+@augmont\.com$`; phone required + `^\d{10}$`.

**Flow — Add sales team member:** Sales Team tab → Add User → fill name/email(@augmont.com)/country/phone → save (check) → `addSalesPerson` → toast "Member added successfully".
**Flow — Authorize calendar:** click link icon on "Not Authorized" member → `authorizeCalendar` → toast "Authorization email sent"; success banner appears on OAuth return (`?calendarAuth=success&name=`).

---

## 14. Contact Us Queries
Route: `/admin/contact-us-queries` — files: `src/app/pages/admin/contact-us-queries/contact-us-queries.component.{html,ts}`

| Element/Button | Selector | Handler | Action/Result |
|---|---|---|---|
| Search | `input[pInputText]` ngModel `searchTerm` | `sanitizeSearchInput`→`onSearchChange` | Debounced query search |
| Row actions (⋮) | `button` `pi-ellipsis-v` | `op.toggle($event)` | Open popover |
| View Message | popover button "View Message" `pi-eye` | `viewMessage(query)` | Opens details dialog |
| Details dialog | `p-dialog` "Contact Us Query Details" | — | Shows name/email/mobile/date/message (read-only) |
| Paginator | `p-paginator` | `changePage($event)` | pageSize 5 |

Read-only — no approve/reject. Service: `AdminContactUsQueriesService.fetchAllQueries`.

---

## 15. Seller Home
Route: `/seller` — **Note:** `src/app/routes/seller.routes.ts` loads `../pages/buyer/home/home.component` for path `''`, `data: { roles: ['seller'] }`. The component at `src/app/pages/seller/home/home.component.{html,ts}` is **not wired into any route** (static "Home Works" placeholder).

---

## Notes for test generation (admin)
- Almost every action button is wrapped in `@if (ability.can(action, subject))` — seed the test user's role/permissions accordingly or expect the element to be absent.
- Tables use PrimeNG (`p-table`, `p-paginator`, `p-select`, `p-toggleSwitch`, `p-dialog`, `p-popover`, `p-confirmpopup`). For Playwright, target by visible text/label, `pInputText` placeholder, or role, since most elements lack stable `id`s. Notable stable ids: `#return-qc-fail-reason`, `#return-courier-partner`, `#return-mobile-number`, `#fileInput`, form field ids in dialogs (`#name`, `#email`, `#lastName`, `#idNumber`, `#mobileNumber`, `#role`, `#userType`, `#roleId`, `#message`).
- Toasts (`p-toast`) confirm success/error; assert on toast detail text listed above.
- Confirmation dialogs share the `app-confirmation-dialog` component with configurable header/confirm label.

---

# SECTION: Shared & Common Components Reference

All standalone Angular components; PrimeNG-based.

---

## GLOBAL ERROR / TOAST UX (read first — testers)

- Toast engine: PrimeNG `MessageService` (`p-toast`), wrapped by `HelperService.showMessage(message, severity, title?)` and `HelperService.showErrorMessages(string[])`.
  - File: `src/app/core/services/helper.service.ts`.
  - `showMessage`: severities `success|error|warn|info`; summary auto-maps to Success/Error/Warning/Info; `life: 3000` ms (toast auto-dismisses after 3s).
  - `copyToClipboard(value, showMessage=true)`: on success toast "Copied to clipboard" (success); on failure "Failed to copy to clipboard" (error).
- HTTP interceptor: `src/app/core/interceptors/auth.interceptor.ts`
  - Adds header `Authorization: Bearer <token>` (token from localStorage `token`) and an HMAC `signature` header on all non-excluded URLs; prefixes `environment.API_URL`.
  - Excluded hosts (no auth/signature): pyprod.augmont.com, ipapi.co, lgdblog, lgd-tools, Amplitude, and `assets/i18n/`.
  - Header `X-Skip-Error` suppresses global error toasts; `X-Multi-Reqs` skips response handling; `X-Loader-Skip` stripped before send.
  - Error handling `handleError` by status:
    | Status | Behavior |
    |---|---|
    | 400 | Show extracted error messages as toasts; if message includes "not valid request" → `router.navigate(['/login'])` |
    | 401 | `initializationService.reset()`, `helperService.clearStorage()`, redirect `/login` (no toast) |
    | 403 / 404 / 500 | Toast `error.error.message` if present |
    | 504 | Redirect `/login` |
  - All non-suppressed messages routed through `showErrorMessages` → error toasts.

---

## app-filters (drawer filters)
Files: `src/app/pages/common/filters/filters.component.{ts,html}`
Used by (selector `<app-filters>`): `filters-full-page`, `buyer/home`, `buyer/products`, `buyer/melee-products`.

Inputs: `showDrawer` (bool), `productLine` (`'lgd'|'melee'`), `openWithFilterType` (`'main'|'advanced'`), `drawerInitialFilters`. Outputs: `onHide`, `filtersReset`.
Left-side PrimeNG `p-drawer` (max-w 896px). Two tabs: Main Filters / Advanced Filters (hidden for melee). Contains a giant reactive `filterFormGroup` + a `selections` signal (Set per category).

| Element/Button | Selector (id/class/text) | Handler | Action/Result |
|---|---|---|---|
| Close X | `button > i.pi-times` (top right) | `closeDrawer()` | Restores initial state, hides drawer, emits `onHide(false)` |
| Main Filters tab | `.filter-main-tab` text "Main Filters" | `setActiveTab('main')` | Switches active tab signal |
| Advanced Filters tab | `.filter-main-tab` text "Advanced Filters" | `setActiveTab('advanced')` | Switches tab |
| Certificate chip | `.filter-toggle-btn` (cert name) | `toggleSelection('certificate', cert)` | Toggles selection Set, highlights bg-primary |
| Growth method chip | `.filter-toggle-btn` | `toggleSelection('treatment', growthType)` | Toggle |
| Media Image/Video/Available toggles | `p-toggleswitch formControlName="hasImage"/"hasVideo"/"availableProduct"` | form control | Boolean filter |
| Shape button | grid button (shape name + SVG) | `toggleSelection('shape', shape)` | Toggle; Round auto-applies 3EX cut/polish/sym |
| Show more/less | `.text-primary` "Show more/less" | `shapeExpand = !shapeExpand` | Expands shape grid |
| Color White/Fancy tab | `.color-type-tab` | `filterFormGroup.get('colorType').setValue(...)` | Switches color mode |
| No BGM toggle | `p-toggleswitch formControlName="isBgm"` | valueChanges sub | Forces shade/luster to 'none' |
| Color chip | `.filter-btn` (D..M) | `toggleColor(color)` | Continuous-range toggle |
| Carat Min/Max | `p-inputnumber #minCarat/#maxCarat` | form control | Range; validated (both required, no equal) |
| Carat chip | `.filter-btn` | `toggleCarat(carat)` | Sets min/max from selected ranges |
| Clarity chip | `.filter-btn` | `toggleClarity(clarity)` | Continuous toggle |
| Eye Clean toggle | `p-toggleswitch formControlName="eyeClean"` | form | Boolean |
| Fluorescence chip | `.filter-btn` | `toggleFluorescenceIntensity(f)` | Continuous toggle |
| Cut/Polish/Sym preset | `.filter-btn-wide` (3EX etc.) | `toggleSelectionCutPolishSymmetry(preset)` | Applies/clears preset sets |
| Cut / Polish / Symmetry chips | `.filter-btn-wide` | `toggleCut/togglePolish/toggleSymmetry` | Continuous toggle |
| Culet / Girdle chips | `.filter-toggle-btn` | `toggleCulet` / `toggleGirdle` | Continuous toggle |
| Parameters min/max (Length,Width,Depth,L/W,Crown,Table,Pavilion,Depth%) | `p-inputnumber formControlName=...` | form | Range validated per pair |
| Preset Ratio | button (`presetRatio`) | `toggleSelection('presetRatio', preset)` | Single-choice; sets minLwRatio/maxLwRatio |
| Price / Price-per-ct tab | `.color-type-tab` | `priceFilterValue` setValue | Switch price mode |
| Price Min/Max | `p-inputnumber formControlName="minFinalPrice"...` | form | Range |
| Shade & Luster selects | `p-select formControlName="colorShade"/"shade"/"luster"` | form | Single select w/ clear |
| Melee: color chips / cut / clarity / growth / dimension multiselect | various `.filter-btn` + `p-multiSelect formControlName="meleeSizePreset"/"meleeCaratPreset"` | `toggleSelection('melee_*',...)`, `toggleTreatment`, `clearMeleeDimensions` | Melee subset |
| Per-section "Clear" | `.filter-clear-btn` | `clearSelection(cat)` / `clearMedia`/`clearParameters` etc. | Clears that section |
| Reset Filter (footer) | white text btn, `[disabled]="!filtersLoaded()"` | `clearFilters()` | Resets form+selections, clears localStorage `savedFilters`/`savedFiltersMelee`, `userService.filters.set(null)`, emits `filtersReset`, closes drawer |
| Apply & Find Diamonds (footer) | white pill "Apply & Find Diamonds" `[disabled]="!filtersLoaded() || !isApplyEnabled()"` | `saveFilters()` | Persists filters to localStorage + `userService.filters`, fires analytics, navigates `/buyer/products` (or `/buyer/products/melee`) |

Validators: `minCarat/maxCarat` require both + not equal; every max* has `maxZeroValidator` (0 disallowed); range pairs via `CustomValidator.rangeGroupValidator`. Error strings via `pairError()` (e.g. "0 values is not allowed in max field", "Minimum value cannot be greater than maximum value", "Please enter both minimum and maximum values.").

Flow — apply a filter:
1. Open drawer (`showDrawer=true`) → `ngOnChanges` stores initial state, restores saved filters.
2. Toggle chips / enter ranges → `selections` signal + form update; Apply button enables when `isApplyEnabled()`.
3. Click "Apply & Find Diamonds" → `saveFilters()` persists → navigates to products list → product list refreshes from saved filters.
4. Click "Reset Filter" → clears everything, closes; product list shows unfiltered.
5. Click X / outside → `closeDrawer()` restores pre-open state (no apply).

---

## app-filters-full-page
Files: `src/app/pages/common/filters-full-page/filters-full-page.component.{ts,html}`
Used by: `buyer/home/home.component.html`. Embeds `<app-filters>` (drawer for Advanced) and `<app-save-filter-popover>`.

Uses separate `caratFormGroup`, `parametersFormGroup`, `priceFormGroup` + `selections` signal + plain fields (colorType, shade, etc.). Same filter categories as drawer but rendered inline. Default landing filters applied when none saved.

| Element/Button | Selector (id/class/text) | Handler | Action/Result |
|---|---|---|---|
| Main / Advanced tab | `.filter-main-tab` | `activeFilterTab.set(...)` | Switch inline main vs. open advanced drawer |
| Saved Searches | `.saved-search-btn` `#saveFilterButton` | `toggleSaveFilter($event)` | Opens `SaveFilterPopover` with current filters |
| All filter categories | same class names as drawer (`.filter-toggle-btn`, `.filter-btn`, `.filter-btn-wide`, `.color-type-tab`, `p-inputnumber`, `p-select`, `p-toggleswitch`) | `toggleSelection`, `toggleCarat`, `toggleClarity`, `toggleColor`, `toggleCut/Polish/Symmetry`, `togglePresetRatio`, `onTreatmentChange`, `toggleCulet/Girdle`, `toggleFluorescenceIntensity` | Update selections/forms |
| No BGM | `p-toggleswitch [ngModel]="isBgm"` | `onBgmChange($event)` | Forces shade/luster 'none' |
| Section Clear | `.filter-clear-btn` | `clearSelection(cat)` etc. | Clears section |
| Reset Filter (footer) | white btn `[disabled]="!filtersLoaded()"` | `onReset()` | Resets to cleared state, persists cleared filters |
| Apply & Find Diamonds (footer) | white pill `[disabled]="!filtersLoaded() || caratFormGroup.invalid || parametersFormGroup.invalid || priceFormGroup.invalid"` | `onApplyFilters()` | Persist filters, analytics, `router.navigate(['/buyer/products'])` |

Flow: land on page → default/saved filters restored via effect once lookups load → edit inline → Apply → navigate to `/buyer/products` (list refreshes).

---

## app-search-panel
Files: `src/app/pages/common/search-panel/search-panel.component.{ts,html}`
NOT currently referenced by selector anywhere. Generic reusable search bar.
Inputs: `searchFields: SearchField[]`, `showClearButton`. Outputs: `search` (emits form value on every change), `clear`.
| Element | Selector | Handler | Action |
|---|---|---|---|
| Text input per field | `input[pInputText][formControlName]` | valueChanges | Emits `search` with full form value |
| Clear all | `button.bg-primary` text "Clear all" | `clearFilters()` | Resets form, emits `clear` |

---

## app-orders-table
Files: `src/app/pages/common/orders-table/orders-table.component.ts`
NOT referenced by selector (legacy). Inputs: `orders`, `loading`, `totalProducts`, `statuses`. Outputs: `onLoad`, `updateOrderStatus({id,statusId})`, `pageChange`, `pageSizeChange`.
Key handlers: `toggleRow(row)` (expand), `navigateToProductDetail(productId)` → `/buyer/products/:id`, `showDialog(order)` (status-change dialog, allowed transitions), `updateStatus()` (emits `updateOrderStatus`), `onPageChange`/`onPageSizeChange`.

---

## app-users-table
Files: `src/app/pages/common/users-table/users-table.component.{ts,html}`
Inputs: `tableHeaders`, `users`, `totalUsers`, `currentPage`, `pageSize`, `pageSizeOptions`, `loading`, `error`, `isSellerTable`, `filtersData`. Outputs: `pageChange`, `pageSizeChange`, `uploadInventory`, `marginUpdate`.
| Element | Handler | Action |
|---|---|---|
| Pagination (embedded `app-pagination`) | `onPageChange` / `onPageSizeChange` | Emit page/size |
| Upload inventory (CSV) | `onFileSelected(event,user)` | Validates `.csv`, emits `uploadInventory({file,user})` |
| Row expand | `toggleRow(row)` | Expands margin/detail row |
| Save margin | `saveMarginData(sellerId,newMargin)` | Emits `marginUpdate({sellerId,margin})` |

---

## app-pagination (common — Previous/Next style)
Files: `src/app/pages/common/pagination/pagination.component.{ts,html}`
Used by: admin-all-products, users-table, buyback-request, buyback-order, requests, matching-pair, orders.
Inputs: `currentPage`, `pageSize`, `totalRecords?`, `totalPages?`, `hasMore?`, `pageSizeOptions=[10,25,50,100]`. Outputs: `pageChange`, `pageSizeChange`.
| Element | Selector | Handler | Action |
|---|---|---|---|
| Page-size select | `select[ngModel]` | `onPageSizeChange()` | Emits `pageSizeChange(size)` |
| Previous | `button` text "Previous" `[disabled]="currentPage===1"` | `onPageChange(currentPage-1)` | Emits `pageChange` |
| Next | `button` text "Next" | `onPageChange(currentPage+1)` | Emits `pageChange` |
Shows "Showing X to Y of N entries" when `totalRecords` set.

## app-pagination (core — numbered pages)
Files: `src/app/core/components/pagination/pagination.component.{ts,html}` — SAME selector `app-pagination`, different component (numbered 1..7 + ellipsis).
Inputs (signals): `totalRecords` (required), `rows=10`, `currentPage=1`. Output: `pageChange` (`{page,rows,first}`).
⚠️ Disambiguate by page: admin numbered pages use core; buyer list pages use common Prev/Next.

---

## app-request-detail-dialog
Files: `src/app/pages/common/request-detail-dialog/request-detail-dialog.component.{ts,html}`
Used by: `buyer/products`, `buyer/products/product-detail`.
Inputs: `product`, `preselectedTypes` (DetailRequestType[]). PrimeNG `p-dialog` (480px, closable=false).
Options built dynamically from missing details: Request Photo (`diamond_image`), Request Video (`diamond_video`), Request Shade (`shade`), Request Luster (`luster`), + "All of the above".
| Element/Button | Selector | Handler | Action/Result |
|---|---|---|---|
| Close X | `button[aria-label="Close"] i.ph-x` | `close()` | `visible.set(false)` |
| Option row + checkbox | `.request-checkbox` (`p-checkbox`) | `toggleSelection(option.value)` | Toggle in `selectedOptions` Set; "all" selects/deselects all |
| Cancel | `p-button` "Cancel" | `close()` | Close |
| Submit Request | `p-button` "Submit Request" `[disabled]="selectedOptions.size===0"` | `submitDetailRequest()` | `productService.createDetailRequest(id,types)`; success toast "Detail request submitted…" + closes; error toast from server msg |

Flow: open dialog (from media "Request Video"/"Request Photo") → preselected types applied → toggle options → Submit → API POST → success toast, dialog closes; if all details exist shows "This product already has all details".

---

## app-download-dialog
Files: `src/app/pages/common/download-dialog/download-dialog.component.{ts,html}`
Used by: `product-card`, `matching-pair/pair-body`.
| Element/Button | Selector | Handler | Action/Result |
|---|---|---|---|
| Trigger icon | `.theme-icon-context i.ph-download-simple` (tooltip "Download Media") | `open()` | Opens options dialog |
| Download Photo | row "Download Photo" | `downloadPhoto()` | Downloads video still `/still.jpg` or image URL; closes |
| Download Video | row "Download Video" | `downloadVideo()` | Progress dialog; `videoGenerationService.generate360Video`; error toasts |
| Copy Video Link | "Copy Link" `i.ph-link` | `copyVideoLink()` | Copies `sharingUrl?id=<sku>` → toast "Copied to clipboard" |
| Download (progress ready) | full-width btn "Download" | `downloadProcessedVideo()` | Blob download; toast "360 Video download started" |
| Try Again (error) | btn "Try Again" | `retryDownload()` | Restarts generation |
Progress dialog states: `generating` (circular %), `ready`, `downloaded`, `error`.

---

## app-cart-popover-item
Files: `src/app/pages/common/cart-popover-item/cart-popover-item.component.{ts,html}`
Used by: `cart/cart-popover`. Input: `diamond` (required). Output: `remove(string id)`. Handles LGD, inventory melee, request melee.
| Element | Selector | Handler | Action/Result |
|---|---|---|---|
| Copy SKU | `button i.ph-copy` (LGD only) | `copySku()` | Toast |
| Total Parcels toggle (melee) | button + `p-popover #parcelsPopover` | `parcelsPopover.toggle($event)` | Parcels breakdown |
| Move to wishlist | `.popover-item-action-btn i.ph-heart` | `moveToWishlist()` | Adds/removes wishlist |
| Remove | `.popover-item-action-btn i.ph-trash` | `removeItem()` | `remove.emit(diamond.id)` |

---

## app-hover-action-bar
Files: `src/app/pages/common/hover-action-bar/hover-action-bar.component.{ts,html}`
Used by: `admin/admin-unapproved-products`, `buyer/products`. Bottom PrimeNG `p-drawer` (non-modal). Input `showDrawer`, output `onHide`. Action buttons projected via `<ng-content>` (e.g. bulk Add to Cart / Approve Selected).

---

## app-share
Files: `src/app/pages/common/share/share.component.{ts,html}`
Used by: products, product-detail, product-card, matching-pair.
| Element | Selector | Handler | Action/Result |
|---|---|---|---|
| Share button | `p-button i.ph-share-network` | `popover.toggle($event)` | Opens Share Via popover |
| Whatsapp | `.share-popover` row "Whatsapp" | `shareModalOpen('whatsapp')` | Opens share-stone dialog (whatsapp mode) |
| Email | row "Email" | `shareModalOpen('email')` | Opens share-stone dialog (email mode) |

---

## app-faq-section
Files: `src/app/pages/common/faq-section/faq-section.component.{ts,html}`
Used by: `public/about-us`, `buyer/faq`. Category tabs set `faqsType` = `platform`/`benchmarkPricing`/`buybackGuarantee`/`invoicing`/`delivery`; content is `p-accordion` — click headers to expand. No API.

---

## app-pricing-tool
Files: `src/app/pages/common/pricing-tool/pricing-tool.component.{ts,html}`
Used by: `buyer/home`. Grid of color (D–H) × clarity (VVS1..SI1); hover reveals Buy/Sell.
| Element | Handler | Action/Result |
|---|---|---|
| Buy cell (hover) | `buyDiamond(cellData)` | Builds `savedFilters`, saves to localStorage, navigate `/buyer/products` |
| Sell cell (hover) | `sellDiamond()` | Opens "Reselling Guidelines" `p-dialog` |
⚠️ `buyDiamond` references `this.helperService` but no `helperService` is injected in the .ts (potential runtime bug — flag for tests).

---

## app-add-buyer-seller
Files: `src/app/pages/common/add-buyer-seller/add-buyer-seller.component.{ts,html}`
Used by: `admin/sellers`. Inputs: `header='Add New Seller'`, `countries`. Outputs: `sellerAdded(BuyerForm)`, `dialogClosed`. `p-dialog` (65rem). `show()`/`hide()`.

Form `sellerForm` fields + validators: firstName/lastName (required), email (required, email), mobileNumber (required, pattern), companyName/tradingName/businessType/businessRole/addressLine1/addressLine2 (required), landmark (optional), countryId (required; `onCountryChange` loads states, pincode length 6 IN / 5 else), stateId (required; loads cities), cityId (required), pincode (required, onlyNumberWithLength), panNumber (required, auto-filled from GSTIN), nameAsPerPan (required), dob (required, maxDate today), gstin (required, GSTIN pattern), incorporationDate (required), arnNumber (required).
Cancel → `hide()`; Save (`[disabled]="!sellerForm.valid"`) → `onSubmit()` → emits `sellerAdded(formattedData)`.

---

## app-add-address (common, DynamicDialog)
Files: `src/app/pages/common/add-address/add-address.component.ts`
Opened as PrimeNG DynamicDialog. Form `addressForm`: landmark (required; removed for US), countryId/stateId/cityId (required, cascading lookups), pincode (required, onlyNumberWithLength(5,6)), addressLine1/2 (required).
Cancel → `dialogRef.close()`; Save → `checkoutService.saveAddress` → close(true). File select validates PDF/JPEG/PNG ≤5MB.

---

# CORE REUSABLE COMPONENTS (`src/app/core/components`)

## app-form-control
Files: `src/app/core/components/form-control/form-control.component.{ts,html}`
Wrapper: label + `<ng-content>` (input) + validation error slot. Used across all forms.
Shows `*` when required. `getActiveErrorMessage()` error copy (assert these):
- required → "Field is required"; email → "Invalid Email ID"; pattern → "Invalid format"; min → "Minimum value of the field is : X"; max → "Maximum value of the field is : X"; maxlength/minlength → "Maximum/Minimum Length : X"; maxZero → "0 values is not allowed in max field"; mismatch → "<label> does not match"; range errors ("Minimum value cannot be greater than maximum value"); password → full password-rules message.

## app-confirmation-dialog
Files: `src/app/core/components/confirmation-dialog/confirmation-dialog.component.{ts,html}`
Used by: user-type-master, book-demo-sales-team, internal-users, replace-stone-dialog, stone-recommendation-dialog, company-details, sellers, role-and-permission.
Inputs: `header`, `width`, `confirmLabel`, `cancelLabel`, `confirmSeverity`, etc. Outputs: `confirm`, `cancel`. Methods `show()`/`hide()`. NOT auto-dismissed on confirm (host controls).

## app-admin-table
Files: `src/app/core/components/admin-table/admin-table.component.{ts,html}`
Config-driven table. Outputs: `sortChange`, `actionClick({action,row})`, `linkClick`, `chipClick`.
| Element | Selector | Handler | Action |
|---|---|---|---|
| Sortable header | `[pSortableColumn]` + `p-sortIcon` | `onSort($event)` | Emits sortChange |
| Link cell | `.text-primary.cursor-pointer` | `onLinkClick(row,col)` | Emits linkClick |
| Chip cell | `p-chip` | `onChipClick(row,col)` | Emits chipClick |
| More actions btn | `button[aria-label="More actions"]` ellipsis | `op.toggle($event)` | Opens `p-popover` with action list |
| Popover action | button (action.label) | `onActionClick(action,row)` | Emits actionClick |
Actions gated by CASL `ability.can(action.action, action.subject)` unless `skipAbilityCheck`.

## app-admin-page-header
Files: `src/app/core/components/admin-page-header/admin-page-header.component.{ts,html}`
| Element | Selector | Handler | Action |
|---|---|---|---|
| Tab select | `p-selectButton` | `onTabChange($event)` | emit tabChange |
| Date range | `p-datepicker[formControlName="createdAt"]` range | `onDateRangeChange()` | emit dateRangeChange; toast "Please select end date" if only start chosen |
| Clear date | `i.pi-times` | `onClearDateRange($event)` | emit clearDateRange |
| Search input | `input[formControlName="search"]` | `sanitizeSearchInput` → `onSearchChange()` | emit searchChange |
| Status filter | `p-select[showClear]` | `onStatusChange($event)` | emit statusChange |
| Action button | `button[pButton]` | `onActionButtonClick()` | emit actionButtonClick (e.g. Add New) |

## app-admin-page-content
Wrapper for table area: error banner, `<ng-content>`, `p-paginator`, empty state ("No data found" default). Output `pageChange`.

## app-password
Files: `src/app/core/components/password/password.component.{ts,html}`
Used by: sign-up-form, reset-password-form, update-password, login, change-password. ControlValueAccessor.
| Element | Selector | Handler | Action |
|---|---|---|---|
| Password input | `input#password` | `onInput` (strips spaces), `onKeyDown` (blocks space) | Updates value |
| Show/hide toggle | `p-inputicon i.ph-eye/ph-eye-slash` | `togglePassword()` | Toggles input type |
| Strength bars (4) | shown when `showIndicator` and interacted | computed `passwordState()` | Rules: ≥8 chars, upper, lower, digit; allowed specials `%#@!*&^$` |

## app-media
Files: `src/app/core/components/media/media.component.{ts,html}`
Used across product cards/tables/dialogs. `p-carousel` with image + 360 video view.
| Element | Selector | Handler | Action |
|---|---|---|---|
| Image | `img[loading=lazy]` | hover plays 360 after 800ms | — |
| Request Video overlay | `button` "Request Video" | `onRequestPhotoClick($event)` | emit `requestPhoto` |
| Request Photo (placeholder) | `button` "Request Photo" | `onRequestPhotoClick($event)` | emit `requestPhoto` |
| Carousel dots | `button[aria-label="Slide N"]` | `goToSlide($index)` | Change slide |
| Unavailable banner | `.bg-error-light` "Stone Unavailable" | — | When `unavailable()` |
| QC banner | `.bg-warning-light` "QC Not Passed" | — | When `qcFailed()` |

## app-scrollable-tags
Input `diamond`. Output `requestDetail({product, openFor:'shade'|'luster'})`. Tag texts: "No Shade", "Request Shade", "Excellent Luster", "Request Luster", "100% Eye Clean". Arrow scroll buttons.

## app-admin-seller-default-margin
Used by admin/sellers. Tabs "Lab Grown Diamonds"/"Lab Grown Melee". Save buttons → `addOrUpdateDefaultMargin`; validation error toast "Each country must have at least one margin greater than 0". Gated by `canUpdateDefaultMargin()`.

## app-popover-menu / app-select-button / app-icon-badge / loaders
`app-popover-menu`: `p-menu` popup, `toggleMenu(event)`, item click navigates + `command()`. `app-select-button`: CVA dropdown-via-popover. `app-icon-badge`: presentational. `app-filter-loader`, `app-product-card-skeleton`, `app-diamond-360-loader`: skeletons. `app-diamond-specifications`: spec table display.

---

## Notes for test authors (shared)
- `<app-pagination>` selector is duplicated by two different components — disambiguate by page.
- Filter apply always persists to localStorage keys `savedFilters` (LGD) / `savedFiltersMelee` (melee) and `userService.filters` signal, then navigates to `/buyer/products` — assert list refresh + URL.
- All success/error feedback appears as PrimeNG toasts (3s auto-dismiss); assert on toast detail text.
- 401 anywhere → storage cleared + redirect to `/login` (no toast). Useful for auth-expiry test scenarios.

---

# SECTION: Feeding This Guide to an AI Model & MCP Test Validation

## A. Prompt template for AI test-case generation

Copy the block below into the AI model, replace `{{PAGE_SECTION}}` with the relevant page section from this document (e.g. the whole "Login" or "Cart / Checkout" section), and replace `{{SCOPE}}` with what you want covered.

```text
You are a senior QA engineer. Using ONLY the UI flow reference below, generate test cases for: {{SCOPE}}.

Rules:
1. Base every step on the documented buttons, selectors, handlers, and flows — do not invent UI elements.
2. For each test case output: ID, Title, Preconditions (role + permissions + data), Steps (numbered, each step = one user action with the exact selector/button label), Expected Result per step (URL change, toast text, dialog, API call, localStorage change), Priority (P1–P3), Type (positive/negative/boundary).
3. Include negative cases from the documented validators (required fields, patterns, min/max, disabled-button conditions) and the documented error toasts.
4. Include permission-gated variants for admin pages (element absent when permission missing).
5. Selector preference order: visible button text > id > formControlName > CSS class. The app has NO data-testid attributes.
6. Output as a markdown table (or Gherkin if asked).

UI FLOW REFERENCE:
{{PAGE_SECTION}}
```

Tips:
- Feed one page/flow section at a time — the model produces deeper coverage per flow than when given the entire document.
- Always include Section 1–3 (overview, selector strategy, login setup) plus the "Global error/toast UX" block with any page section, so generated tests know how to log in and what to assert.

## B. MCP test validation (Playwright MCP / Chrome DevTools MCP)

Setup:
1. Start the app: `npm start` → `http://localhost:4200` (uses local API `localhost:3000`; point `environment.ts` at the test API `https://api.testlgd.augmont.com/api/v1/` to run against seeded test data).
2. Connect a browser MCP server (e.g. `npx @playwright/mcp@latest`, or the Chrome DevTools MCP) to the AI agent that executes the generated test cases.
3. Give the agent this document (or the relevant section) as context — the **Selector** column is what it should target, and the **Action/Result** column is what it must verify.

Validation loop the agent should follow per test case:
1. **Session** — log in via UI (`/login`) or seed localStorage (`token`, `userRole`, `permissions`) and navigate directly.
2. **Locate** — resolve the element using the documented priority: button text → id → `formControlName` → class. If not found, check permission gating (admin) or route/layout visibility rules before failing.
3. **Act** — click/type exactly as the flow step says. PrimeNG overlays (select panels, dialogs, popovers) mount on `<body>` — after opening, query options globally.
4. **Assert** — in order of strength: URL equals documented route → toast text matches documented message (toast auto-hides after 3 s, capture quickly) → dialog/drawer visibility → network request to the documented API path → localStorage key updated.
5. **Report** — pass/fail per step with screenshot on failure.

Timing/waits:
- Debounced searches: 300–500 ms before results refresh.
- Add-to-cart button animation: ~2.1 s before the cart popover opens.
- OTP resend timers: 60 s.
- Toasts: 3 s lifetime — assert immediately after action.
- Product list uses infinite scroll (`loadMoreSentinel`) — scroll to load more rows.

Known pitfalls (documented in the sections above):
- Two different components share the `app-pagination` selector (Prev/Next vs numbered) — pick assertion style per page.
- `/unauthorized` redirect target has no route (falls through to home).
- Contact Us form logic exists in TS but is not rendered in the current template.
- `pricing-tool.buyDiamond()` references an uninjected `helperService` (potential runtime error if that path is exercised).
- Public footer "Sign Up to View All Diamonds" has `routerLink="/sign-up"` (no such route); the click handler performs the real navigation.

## C. Regenerating / maintaining this file

- Source of truth: component `.html` (bindings/selectors) + `.ts` (handlers/APIs) under `src/app/pages`, `src/app/layouts`, `src/app/core/components`, plus `src/app/routes/*.ts`.
- When a flow changes, update only that page's section; keep the table format (`Element/Button | Selector | Handler | Action/Result`) so MCP agents can parse it consistently.
- Biggest single improvement for test stability: add `data-testid` attributes to interactive elements and record them in the Selector column here.

this data fedd in ai gernate test case this is some selection and other details 

also fedd exstinf ctest case if same proper 2 time assign this time check this test avaliabe this time not check and dir4ect display alrady this test case added message and show this testcase also 

please add this all thing
</user_query>