import type { SVGProps } from 'react';
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react';
import {
  Alert02Icon, ArrowRight01Icon, Building03Icon, Calendar03Icon,
  ChartHistogramIcon, CodeIcon as HugeCodeIcon, ComputerIcon, CreditCardIcon,
  CustomerSupportIcon, Home01Icon, Invoice03Icon, Key01Icon, KitchenUtensilsIcon,
  LockIcon as HugeLockIcon, MoreHorizontalIcon, PackageIcon, Plug01Icon,
  Logout01Icon, Menu01Icon, PanelLeftIcon, Pulse01Icon, QrCode01Icon,
  RefreshIcon as HugeRefreshIcon, Search01Icon,
  Settings01Icon, Shield01Icon, ShoppingBag01Icon, Ticket01Icon, Tick02Icon,
  UserIcon, UserMultipleIcon,
} from '@hugeicons/core-free-icons';

type IconProps = SVGProps<SVGSVGElement>;

function icon(source: IconSvgElement) {
  return function TrackOjaIcon({ width = 22, height, strokeWidth = 1.7, ...props }: IconProps) {
    return (
      <HugeiconsIcon
        icon={source}
        width={width}
        height={height ?? width}
        strokeWidth={Number(strokeWidth)}
        aria-hidden={props['aria-label'] ? undefined : true}
        {...props}
      />
    );
  };
}

/** One Hugeicons-backed icon source for the entire product. */
export const HomeIcon = icon(Home01Icon);
export const SalesIcon = icon(ShoppingBag01Icon);
export const ScanIcon = icon(QrCode01Icon);
export const ReportsIcon = icon(ChartHistogramIcon);
export const MoreIcon = icon(MoreHorizontalIcon);
export const ProductsIcon = icon(PackageIcon);
export const CustomersIcon = icon(UserMultipleIcon);
export const StaffIcon = icon(UserIcon);
export const DevicesIcon = icon(ComputerIcon);
export const PaymentsIcon = icon(CreditCardIcon);
export const SettingsIcon = icon(Settings01Icon);
export const SubscriptionIcon = icon(Invoice03Icon);
export const SupportIcon = icon(CustomerSupportIcon);
export const ChevronRightIcon = icon(ArrowRight01Icon);
export const AlertIcon = icon(Alert02Icon);
export const KitchenIcon = icon(KitchenUtensilsIcon);
export const ExpiryIcon = icon(Calendar03Icon);
export const BuildingIcon = icon(Building03Icon);
export const KeyIcon = icon(Key01Icon);
export const PlugIcon = icon(Plug01Icon);
export const PulseIcon = icon(Pulse01Icon);
export const CodeIcon = icon(HugeCodeIcon);
export const ShieldIcon = icon(Shield01Icon);
export const TicketIcon = icon(Ticket01Icon);
export const SearchIcon = icon(Search01Icon);
export const RefreshIcon = icon(HugeRefreshIcon);
export const LockIcon = icon(HugeLockIcon);
export const CheckIcon = icon(Tick02Icon);
export const MenuIcon = icon(Menu01Icon);
export const LogoutIcon = icon(Logout01Icon);
export const SidebarIcon = icon(PanelLeftIcon);
