import { slashCommands } from '../../utils/client/slashCommand';
import { imperativeModal } from '../../../client/lib/imperativeModal';
import { CreatePollModal } from './CreatePollModal';

slashCommands.add({
    command: 'poll',
    callback: (_command, _params, item) => {
        imperativeModal.open({
            component: CreatePollModal,
            props: {
                roomId: item?.rid,
            },
        });
    },
    options: {
        description: 'Create a poll',
        params: '',
    },
    clientOnly: true,
});