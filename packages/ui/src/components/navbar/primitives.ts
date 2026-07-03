/**
 * NavBar primitives — composable top-bar.
 *
 *   import * as NavBar from '@blueprint/ui/navbar';
 *
 *   <NavBar.Root>
 *     <NavBar.Brand href="/">quantifai-next</NavBar.Brand>
 *     <NavBar.Switcher>
 *       <NavBar.Item href="/discover" active>Discover</NavBar.Item>
 *       <NavBar.Item href="/try">Try</NavBar.Item>
 *       <NavBar.Item href="/build">Build</NavBar.Item>
 *       <NavBar.Item href="/operate">Operate</NavBar.Item>
 *       <NavBar.Item href="/inspect">Inspect</NavBar.Item>
 *       <NavBar.Item href="/roadmap">Roadmap</NavBar.Item>
 *     </NavBar.Switcher>
 *     <NavBar.Actions>
 *       <AudienceSwitcher value={...} onChange={...} />
 *     </NavBar.Actions>
 *   </NavBar.Root>
 *
 * Item.asChild lets the consuming framework's router (Astro <a>,
 * next/link, etc.) be swapped in.
 */

export { NavBarRoot as Root, type NavBarRootProps as RootProps } from './primitives/navbar-root';
export { NavBarBrand as Brand, type NavBarBrandProps as BrandProps } from './primitives/navbar-brand';
export { NavBarSwitcher as Switcher, type NavBarSwitcherProps as SwitcherProps } from './primitives/navbar-switcher';
export { NavBarItem as Item, type NavBarItemProps as ItemProps } from './primitives/navbar-item';
export { NavBarActions as Actions, type NavBarActionsProps as ActionsProps } from './primitives/navbar-actions';
