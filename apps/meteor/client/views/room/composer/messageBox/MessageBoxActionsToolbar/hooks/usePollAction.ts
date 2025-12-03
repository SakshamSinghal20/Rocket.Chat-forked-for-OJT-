import type { GenericMenuItemProps } from '@rocket.chat/ui-client';
import { useTranslation } from '@rocket.chat/ui-contexts';
import { useMemo } from 'react';

export const usePollAction = (disabled: boolean): GenericMenuItemProps => {
	const t = useTranslation();

	return useMemo(
		() => ({
			id: 'poll',
			icon: 'list' as const,
			content: t('Poll'),
			disabled,
			onClick: () => {
				// Import and show poll modal
				import('../../../../../../../app/slashcommands-poll/client/pollModal').then(({ showPollModal }) => {
					showPollModal();
				});
			},
		}),
		[disabled, t],
	);
};