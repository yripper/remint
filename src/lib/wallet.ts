import { StellarWalletsKit } from '@creit.tech/stellar-wallets-kit/sdk'
import { defaultModules } from '@creit.tech/stellar-wallets-kit/modules/utils'
import { Networks, type SwkAppTheme } from '@creit.tech/stellar-wallets-kit/types'

// Matches the app's tokens (src/index.css) so the wallet modal feels native.
const THEME: SwkAppTheme = {
  background: '#f6f8fb',
  'background-secondary': '#e8edf3',
  'foreground-strong': '#0d1b33',
  foreground: '#22314d',
  'foreground-secondary': '#5b6b85',
  primary: '#2775ca',
  'primary-foreground': '#ffffff',
  transparent: 'rgba(0,0,0,0)',
  lighter: '#ffffff',
  light: '#eef2f7',
  'light-gray': '#d7dee8',
  gray: '#8a97ab',
  danger: '#d6453d',
  border: '#d7dee8',
  shadow: '0 24px 60px -24px rgba(13, 27, 51, 0.35)',
  'border-radius': '14px',
  'font-family': '"Bricolage Grotesque", system-ui, sans-serif',
}

let initialized = false

export function initWalletKit(): void {
  if (initialized) return
  StellarWalletsKit.init({ modules: defaultModules(), network: Networks.PUBLIC, theme: THEME })
  initialized = true
}

export { StellarWalletsKit }
