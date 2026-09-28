import type { SVGProps } from 'react';
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react';
import {
  DatabaseIcon as HugeDatabaseIcon,
  Invoice03Icon,
  Mail01Icon,
  TestTube01Icon,
  WebhookIcon as HugeWebhookIcon,
} from '@hugeicons/core-free-icons';

type IconProps = SVGProps<SVGSVGElement>;

function icon(source: IconSvgElement) {
  return function PlatformIcon({ width = 22, height, strokeWidth = 1.7, ...props }: IconProps) {
    return <HugeiconsIcon icon={source} width={width} height={height ?? width} strokeWidth={Number(strokeWidth)} aria-hidden {...props} />;
  };
}

export const ContractIcon = icon(Invoice03Icon);
export const WebhookIcon = icon(HugeWebhookIcon);
export const DatabaseIcon = icon(HugeDatabaseIcon);
export const MailIcon = icon(Mail01Icon);
export const SandboxIcon = icon(TestTube01Icon);
