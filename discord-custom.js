
module.exports = function(discord, config, action, message) {
    true &&
        discord.createMessage('000000000000000000', action);
    !(typeof message.args === 'object' && message.args[2] === 'You said !banmepls') &&
        discord.createMessage('000000000000000000', action);
    !(message.created_by === config.user) &&
        discord.createMessage('000000000000000000', action);
};
