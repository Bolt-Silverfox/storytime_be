import { needsProductionConfirmation } from '@/importers/gutenberg/gutenberg-cli.args';

export const canRunDestructiveDbTests = (databaseUrl?: string): boolean =>
  !!databaseUrl && !needsProductionConfirmation(databaseUrl);
