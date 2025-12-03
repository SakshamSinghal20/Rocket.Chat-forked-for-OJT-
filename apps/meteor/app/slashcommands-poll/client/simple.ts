// Simple poll modal - basic version
import { slashCommands } from '../../utils/client/slashCommand';

// Add client-side poll command
slashCommands.add({
    command: 'poll',
    callback: () => {
        // Simple alert for now - will replace with modal later
        alert('Poll modal would open here!');
        console.log('Poll command clicked - modal should open');
    },
    options: {
        description: 'Create a poll',
        params: ''
    },
    clientOnly: true // This runs on client only
});