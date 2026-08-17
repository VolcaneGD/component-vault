import type { ComponentRecord, PreviewPolicy } from '../../../../shared/contracts';
import type { PreviewError } from '../feedback/ErrorConsole';

export const PREVIEW_INIT_CHANNEL = 'component-vault:preview:init';
export const PREVIEW_READY_CHANNEL = 'component-vault:preview:ready';
export const PREVIEW_EVENT_CHANNEL = 'component-vault:preview:event';
export const MAX_PREVIEW_ERRORS = 50;
export const MAX_PREVIEW_ERRORS_PER_SECOND = 20;
export const MAX_PREVIEW_MESSAGE_LENGTH = 2_000;
export const MAX_PREVIEW_STACK_LENGTH = 8_000;
export const MAX_PREVIEW_RESOURCE_LENGTH = 2_048;

export interface PreviewReadyMessage {
  channel: typeof PREVIEW_READY_CHANNEL;
  previewId: string;
}

export interface PreviewEventMessage {
  channel: typeof PREVIEW_EVENT_CHANNEL;
  previewId: string;
  error: PreviewError;
}

const boundedString = (value: unknown, maximum: number): string => {
  let result: string;
  if (typeof value === 'string') {
    result = value;
  } else {
    try {
      const serialized = JSON.stringify(value);
      result = serialized === undefined ? String(value) : serialized;
    } catch {
      try {
        result = String(value);
      } catch {
        result = 'Unserializable value';
      }
    }
  }
  return result.length <= maximum ? result : `${result.slice(0, maximum - 1)}…`;
};

const optionalNumber = (value: unknown): number | undefined => (
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined
);

const optionalBoundedString = (value: unknown, maximum: number): string | undefined => (
  value === undefined ? undefined : boundedString(value, maximum)
);

const canonicalHttpsOrigin = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.origin === value ? value : undefined;
  } catch {
    return undefined;
  }
};

export const normalizePreviewError = (value: unknown): PreviewError | null => {
  if (typeof value !== 'object' || value === null) return null;
  const error = value as Record<string, unknown>;
  if (!['runtime', 'unhandled-rejection', 'csp', 'bootstrap', 'policy'].includes(String(error.type))) {
    return null;
  }

  return {
    type: error.type as PreviewError['type'],
    message: boundedString(error.message, MAX_PREVIEW_MESSAGE_LENGTH),
    line: optionalNumber(error.line),
    column: optionalNumber(error.column),
    stack: optionalBoundedString(error.stack, MAX_PREVIEW_STACK_LENGTH),
    blockedUri: optionalBoundedString(error.blockedUri, MAX_PREVIEW_RESOURCE_LENGTH),
    blockedOrigin: canonicalHttpsOrigin(error.blockedOrigin),
    directive: optionalBoundedString(error.directive, MAX_PREVIEW_MESSAGE_LENGTH),
  };
};

export const isPreviewReadyMessage = (value: unknown): value is PreviewReadyMessage => {
  if (typeof value !== 'object' || value === null) return false;
  const message = value as Record<string, unknown>;
  return message.channel === PREVIEW_READY_CHANNEL && typeof message.previewId === 'string';
};

export const previewPolicyKey = (policy: PreviewPolicy): string => JSON.stringify({
  allowScripts: policy.allowScripts,
  allowForms: policy.allowForms,
  allowPopups: policy.allowPopups,
  externalNetworkEnabled: Boolean(policy.externalNetworkEnabled),
  allowedOrigins: policy.allowedOrigins,
});

export const previewPayload = (
  component: ComponentRecord,
  policy: PreviewPolicy,
  previewTheme: 'light' | 'dark',
) => ({
  channel: PREVIEW_INIT_CHANNEL,
  component: {
    html: component.html,
    css: component.css,
    javascript: component.javascript,
    allowScripts: policy.allowScripts,
    previewTheme,
  },
});
