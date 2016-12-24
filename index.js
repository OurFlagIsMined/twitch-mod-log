
var WebSocket = require('ws');
var request = require('request');
var Eris = require("eris");
var colors = require('colors/safe');
var fs = require('fs');
var os = require('os');

var config = require('./config.json');
var userids = require('./userids.json');

var discordCustom = fs.existsSync('./discord-custom.js') && require('./discord-custom.js');

/** COLORLESS
 *
 */

var colorless = function() {
    for (key in colors.styles) {
        colors.styles[key].open = '';
        colors.styles[key].close = '';
        colors.styles[key].closeRe = /(?:)/g;
    }
};

config.colorless && colorless();

/** CLI
 *
 */

var args = process.argv.slice(2);
if (args) {
    var arg = 0;
    while (arg < args.length) {
        switch (args[arg]) {
            case '-h':
            case '--help':
                console.log('Usage: node index.js [options] ');
                console.log('');
                console.log('Options:');
                console.log('  -h,        --help                    prints help message');
                console.log('  -co,       --colorless,              use colorless mode');
                console.log('  -nc,       --no-colors               (overrides colorless in config file)');
                console.log('  -o (...),  --oauth (...)             set user oauth key');
                console.log('                                       (overrides oauth key in config file)');
                console.log('  -u (...),  --user (...),             set user');
                console.log('             --username (...)          (overrides user in config file)');
                console.log('  -c (...),  --channel (...),          set channel');
                console.log('             --chan (...)              (overrides channel in config file)');
                console.log('  -p,        --purge,                  purge mod log file');
                console.log('             --purge-log,              (WARNING: THIS WILL ERASE YOUR LOG FILE)');
                console.log('  -d,        --discord,                relay mod actions to a Discord channel');
                console.log('                                       (overrides discordEnable in config file)');
                console.log('  -nd,       --no-discord,             don\'t relay mod actions to a Discord channel');
                console.log('                                       (overrides discordEnable in config file)');
                console.log('  -dt (...), --discord-token (...)     Discord token');
                console.log('                                       (overrides discordToken in config file)');
                console.log('  -dc (...), --discord-channel (...),  Discord channel');
                console.log('             --discord-chan (...)      (overrides discordChannel in config file)');
                process.exit();
            
            case '-co':
            case '-nc':
            case '--colorless':
            case '--no-colors':
                colorless();
                arg++;
                break;
            case '-o':
            case '--oauth':
                if (args[arg+1] && /^[0-9A-Za-z_]{2,25}$/.test(args[arg+1])) {
                    config.oauth = args[arg+1];
                    arg += 2;
                }
                else {
                    console.log();
                    arg++;
                }
                break;
            case '-u':
            case '--user':
            case '--username':
                if (args[arg+1] && /^[0-9A-Za-z_]{2,25}$/.test(args[arg+1])) {
                    config.user = args[arg+1];
                    arg += 2;
                }
                else {
                    arg++;
                }
                break;
            case '-c':
            case '--channel':
            case '--chan':
                if (args[arg+1] && /^[0-9A-Za-z_]{2,25}$/.test(args[arg+1])) {
                    config.user = args[arg+1];
                    arg += 2;
                }
                else {
                    arg++;
                }
                break;
            case '-p':
            case '--purge':
            case '--purge-log':
            case '--purge-logs':
                fs.writeFileSync('./mod-log.txt', '');
                arg++;
                break;
            case '-d':
            case '--discord':
                config.discordEnable = true;
                arg++;
                break;
            case '-nd':
            case '--no-discord':
                config.discordEnable = false;
                arg++;
                break;
            case '-dt':
            case '--discord-token':
                if (args[arg+1]) {
                    config.discordToken = args[arg+1];
                    arg += 2;
                }
                else {
                    arg++;
                }
                break;
            case '-dc':
            case '--discord-channel':
            case '--discord-chan':
                if (args[arg+1]) {
                    config.discordChannel = args[arg+1];
                    arg += 2;
                }
                else {
                    arg++;
                }
                break;
            default:
                arg++;
                break;
        }
    }
}

if (!config.oauth || !config.user || !config.channel) {
    console.log(colors.red.bold('Please add your Twitch details to config.json'));
    process.exit();
}

config.oauth = config.oauth.replace(/^oauth:/i,'');
config.user = config.user.toLowerCase();
config.channel = config.channel.toLowerCase();
config.discordToken = config.discordToken && String(config.discordToken);
config.discordChannel = config.discordChannel && String(config.discordChannel);

/** TWITCH PUBSUB
 *
 */

var modLog = [];
var pingTimer;
var pingTimer2;
var PubSub = {
    firstPong: false,
    onFirstPong: undefined,
    closeCalled: false
};
var nonce=function(){
    var str='';
    for (var i=0;i<30;i++){
        var num=Math.floor(Math.random()*52)+65;
        num>90&&(num+=6);
        num>122&&(num=122);
        str+=String.fromCharCode(num);
    }
    return str;
};

var _onMessage = function(e) {
    var self = this;
    
    var now = new Date();
    if (config.debug) {
        console.log(' [' + now.toISOString() + '] ' + 'ws.onmessage');
        console.log(e.data);
    }
    try {
        var t = JSON.parse(e.data);
        
        switch (t.type) {
        case 'PING':
            if (config.debug) {
                console.log('   received PING');
            }
            this.ws.send(JSON.stringify({
                type:'PONG'
            }));
            break;
        case 'PONG':
            if (config.debug) {
                console.log('   received PONG');
            }
            if (!PubSub.firstPong) {
                PubSub.firstPong = true;
                PubSub.onFirstPong();
            }
            break;
        case 'RESPONSE':
            if (t.error) {
                console.log(colors.blue.bold(' [' + now.toISOString() + '] ') + colors.red.bold('error: ' + t.error));
                if (t.error === 'ERR_BADAUTH' || t.error === 'Server Error') {
                    console.log(colors.red.bold(Array(28+1).join(' ') + 'Closing connection'));
                    this.ws.close();
                    clearInterval(pingTimer);
                    clearTimeout(pingTimer2);
                }
            }
            break;
        case 'MESSAGE':
            if (config.debug) {
                console.log('   received message:');
                console.log('     type: ' + t.type);
                console.log('     data: ' + t.data);
                console.log('     topic: ' + t.topic);
            }
            if (t.data.topic.indexOf('chat_moderator_actions') === 0) {
                try {
                    var message = JSON.parse(t.data.message).data;
                    
                    if (message.type === 'chat_channel_moderation' || message.type === 'chat_login_moderation') {
                        console.log(colors.whiteBG(colors.blue.bold(' [' + now.toISOString() + '] ') + colors.red.bold(message.created_by) + ' \r\n ' + colors.black('/' + message.moderation_action + (message.args ? ' ' + message.args.join(' ') : '')) + ' '));
                        
                        modLog.push({
                            timestamp: now.valueOf(),
                            data: t,
                            message: message
                        });
                        
                        var action = '[' + now.toISOString() + '] ' + message.created_by + ': /' + message.moderation_action + (message.args ? ' ' + message.args.join(' ') : '');
                        
                        writeStreamWrite(action);
                        
                        discordSend(action, message);
                    }
                }
                catch (err) {
                    console.log(colors.blue.bold(' [' + now.toISOString() + '] ') + colors.yellow.bold('Error parsing JSON message data:'));
                    console.log(err);
                }
            }
            break;
        case 'RECONNECT':
            console.log(colors.magenta.bold(' Reconect-request received; reconnecting now'));
            this.ws.close();
            clearInterval(pingTimer);
            clearTimeout(pingTimer2);
            PubSub.firstPong = false;
            PubSub.closeCalled = true;
            connect();
        }
    } catch (e) {
        console.log(colors.blue.bold(' [' + now.toISOString() + '] ') + colors.yellow.bold('Error parsing JSON message:'));
        console.log(e);
    }
};
var _onError = function(e) {
    var self = this;
    
    console.log(colors.yellow.bold(' [' + (new Date()).toISOString() + '] ' + 'WebSocket error; reconnecting in 2 seconds:'));
    console.log(e);
    this.ws.close();
    clearInterval(pingTimer);
    clearTimeout(pingTimer2);
    PubSub.firstPong = false;
    PubSub.closeCalled = true;
    setTimeout(function() {
        connect();
    }, 2e3);
};
var _onClose=function(e){
    var self = this;
    
    console.log(colors.magenta.bold(' [' + (new Date()).toISOString() + '] ' + 'WebSocket connection closed'));
    clearInterval(pingTimer);
    clearTimeout(pingTimer2);
    if (!PubSub.closeCalled) {
        PubSub.closeCalled = false;
        console.log(colors.red.bold(Array(28+1).join(' ') + 'Reconnecting in 2 seconds'));
        PubSub.firstPong = false;
        setTimeout(function() {
            connect();
        }, 2e3);
    }
};
var _onOpen=function(e){
    var self = this;
    
    console.log(colors.green.bold(' ['+(new Date()).toISOString()+'] '+'WebSocket connection open'));
    
    this.ws.send(JSON.stringify({
        type: 'PING'
    }));
    
    PubSub.onFirstPong = function() {
        if (config.debug) {
            console.log(' ['+(new Date()).toISOString()+'] ' + 'First pong received');
        }
        
        self.ws.send(JSON.stringify({
            type: 'LISTEN',
            nonce: nonce(),
            data: {
                topics: ['chat_moderator_actions.' + userids[config.user] + '.' + userids[config.channel]],
                auth_token: config.oauth
            }
        }));
        
        pingTimer = setInterval(function(){
            pingTimer2 = setTimeout(function() {
                self.ws.send(JSON.stringify({type:'PING'}));
            }, Math.floor((Math.random() * 2) * 1000) / 1e3);
        },59e3);
    };
};

var connect = function() {
    var self = this;
    console.log(colors.green.bold(' Connecting'));
    this.ws = new WebSocket('wss://pubsub-edge.twitch.tv/v1', {
        protocolVersion: 13, 
        origin: 'https://www.twitch.tv'
    });
    ws.onmessage=_onMessage.bind(self);
    ws.onerror=_onError.bind(self);
    ws.onclose=_onClose.bind(self);
    ws.onopen=_onOpen.bind(self);
};

/** LOG FILE
 *
 */

var writeStream = new fs.WriteStream('./mod-log.txt', {
    'flags': 'a+',
    'encoding': 'utf-8',
    'mode': 0666
});

var writeStreamWrite = function(str) {
    writeStream.write(str + '\r\n');
};

/** USERID LOOKUP
 *
 */

var lookupID = function(username, callback) {
    request.get(
        'https://api.twitch.tv/kraken/users/' + username,
        {headers: {
            'Accept': 'application/vnd.twitchtv.v3+json',
            'Authorization': 'OAuth ' + config.oauth
        }},
        function(error, response, body) {
            if (error !== null) {
                console.log(colors.red.bold('Error looking up user ID:'));
                console.log(error);
                callback(false);
            }
            else if (response.statusCode !== 200) {
                console.log(colors.red.bold('Error looking up user ID: bad status code (' + response.statusCode + ')'));
                callback(false);
            }
            try {
                var user = JSON.parse(body);
                if (user._id) {
                    console.log(colors.magenta.bold('User ID found for ' + username + ': ' + user._id));
                    callback(user._id);
                }
                else {
                    console.log(colors.red.bold('Error looking up User ID: user ID not found'));
                    callback(false);
                }
            }
            catch (e) {
                console.log(colors.red.bold('Error looking up User ID; error parsing JSON:'));
                console.log(e);
                callback(false);
            }
        }
    );
};

var checkIDs = function() {
    if ((userids[config.channel] || userids[config.channel] === false) && (userids[config.user] || userids[config.user] === false)) {
        (userids[config.user] || userids[config.channel]) && fs.writeFile('./userids.json', JSON.stringify(userids , null, 4));
        
        if (userids[config.channel] && userids[config.user]) {
            connect();
        }
        else {
            console.log(colors.red.bold('Unable to get ' + (!channelID ? 'channel ID' : '') + (!channelID && !userID ? ' and ' : '') + (!userID ? 'user ID' : '')));
        }
    }
};

/** DISCORD
 *
 */

var discordSend = function(action, message) {
    if (config.discordEnable) {
        try {
            if (discordCustom) {
                discordCustom(discord, config, action, message);
            }
            else {
                discord.createMessage(config.discordChannel, action);
            }
        }
        catch (e) {
            console.log(colors.blue.bold(' [' + (new Date()).toISOString() + '] ') + colors.yellow.bold('Error sending Discord message'));
            console.log(e);
        }
    }
};

if (config.discordEnable) {
    if (config.discordToken && config.discordChannel) {
        console.log(colors.magenta.bold(' Connecting to Discord'));
        
        var discord = new Eris(config.discordToken);
        
        discord.on('ready', function() {
            console.log(colors.green.bold(' Connected to Discord'));
        });
        
        discord.connect();
    }
    else {
        console.log(colors.yellow.bold(' Unable to connect to Discord: ' + (config.discordToken ? 'discordToken' : '') + ((!config.discordToken && !config.discordChannel) ? ' and ' : '') + (config.discordChannel ? 'discordChannel' : '') + ' not set in config file'));
    }
}

/** PRINT
 *
 */

var print = function(str) {console.log(colors.bold('>' + str));};

/** STDIN
 *
 */

process.stdin.resume();
process.stdin.setEncoding('utf8');

process.stdin.on('data', function (text) {
    var strip = text.slice(0,-os.EOL.length);
    
    console.log(colors.bold('<' + strip));
    
    if (strip === 'quit') {
        done();
    }
    else if (strip.slice(0,5) === 'eval ') {
        try {
            eval(strip.slice(5));
        }
        catch(e) {
            print(colors.yellow('Error.'));
            print(e);
        }
    }
    else if (strip.slice(0,6) === 'print ') {
        try {
            print(eval(strip.slice(6)));
        }
        catch(e) {
            print(colors.yellow('Error.'));
            print(e);
        }
    }
    else if (strip === 'help') {
        print('quit');
        print('eval ...');
        print('print ...');
        print('help');
    }
    else {
        print(colors.yellow('Command not recognized.'));
    }
});

function done() {
    print(colors.red('Terminating.'));
    process.exit();
}

/** CONNECT
 *
 */

function main() {
    if (userids[config.channel] && userids[config.user]) {
        connect();
    }
    else {
        if (!userids[config.channel]) {
            console.log(colors.magenta.bold('Waiting for channel ID lookup'));
            lookupID(config.channel, function(id) {
                userids[config.channel] = id;
                checkIDs();
            });
        }
        if (!userids[config.user]) {
            console.log(colors.magenta.bold('Waiting for user ID lookup'));
            lookupID(config.user, function(id) {
                userids[config.user] = id;
                checkIDs();
            });
        }
    }
}

main();

print(colors.green('Ready.'));
