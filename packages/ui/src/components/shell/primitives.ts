/**
 * Shell primitives — composable portal page chrome.
 *
 *   import * as Shell from '@blueprint/ui/shell';
 *
 *   <Shell.Root>
 *     <Shell.Header><NavBar.Root>...</NavBar.Root></Shell.Header>
 *     <Shell.Main>{children}</Shell.Main>
 *     <Shell.Footer>...</Shell.Footer>
 *   </Shell.Root>
 */

export { ShellRoot as Root, type ShellRootProps as RootProps } from './primitives/shell-root';
export { ShellHeader as Header, type ShellHeaderProps as HeaderProps } from './primitives/shell-header';
export { ShellMain as Main, type ShellMainProps as MainProps } from './primitives/shell-main';
export { ShellFooter as Footer, type ShellFooterProps as FooterProps } from './primitives/shell-footer';
