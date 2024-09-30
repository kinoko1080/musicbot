const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const { createAudioPlayer, createAudioResource, joinVoiceChannel, AudioPlayerStatus, StreamType, VoiceConnectionStatus } = require('@discordjs/voice');
const ytdl = require('@distube/ytdl-core');
const ytpl = require('ytpl');
const { token, youtubeApiKey } = require('./config.json');
const ffmpegPath = require('ffmpeg-static');
const axios = require('axios');

// Discordクライアントを作成し、必要な権限を設定
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.MessageContent
    ]
});

// サーバーごとの音楽キューを管理するためのMapを作成
const queue = new Map();
// Discord.jsから必要なクラスや関数をインポート
const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');

// Discordボイスチャット関連の機能を提供する@discordjs/voiceから関数をインポート
const { createAudioPlayer, createAudioResource, joinVoiceChannel, AudioPlayerStatus, StreamType, VoiceConnectionStatus } = require('@discordjs/voice');

// YouTube動画を音声ストリームとして取得するためのライブラリytdlと、プレイリストを扱うytplをインポート
const ytdl = require('@distube/ytdl-core');
const ytpl = require('ytpl');

// config.jsonからトークンとYouTube APIキーを取得
const { token, youtubeApiKey } = require('./config.json');

// 音声処理のためにFFmpegの実行ファイルのパスを取得（YouTube音声の変換などに必要）
const ffmpegPath = require('ffmpeg-static');

// YouTube APIのリクエストを送るためにaxiosをインポート
const axios = require('axios');

// Discordクライアントを作成。ボットが特定のイベント（メッセージ送信や音声状態の変更など）を処理できるようにするために、必要なインテントを指定
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,          // サーバー内のギルドに関するイベント（例: ギルドが作成された）を受け取る
        GatewayIntentBits.GuildMessages,   // メッセージに関するイベントを受け取る（例: メッセージが送信された）
        GatewayIntentBits.GuildVoiceStates,// ボイスチャンネルの状態変化（接続や切断など）に関するイベントを受け取る
        GatewayIntentBits.MessageContent   // メッセージの内容にアクセスできるようにする
    ]
});

// 各サーバーのキューを管理するためのMapオブジェクトを作成。キューには再生予定の曲のリストなどが格納される
const queue = new Map();

// クライアント（ボット）が起動した際に、一度だけ呼び出されるイベント
client.once('ready', () => {
    console.log('ボットが起動しました！'); // ボットが正常に起動したことをコンソールに出力
});

// メッセージが送信された時に実行されるイベントリスナー
client.on('messageCreate', async message => {
    // ボットが送信したメッセージは無視する
    if (message.author.bot) return;

    // メッセージが「!」で始まっていない場合は無視する
    if (!message.content.startsWith('!')) return;

    // 現在のサーバーの再生キューを取得
    const serverQueue = queue.get(message.guild.id);

    // それぞれのコマンドに応じて処理を分岐
    if (message.content.startsWith('!play')) {
        execute(message, serverQueue); // !playコマンドなら曲の再生を実行
    } else if (message.content.startsWith('!skip')) {
        skip(message, serverQueue);    // !skipコマンドなら次の曲へスキップ
    } else if (message.content.startsWith('!stop')) {
        stop(message, serverQueue);    // !stopコマンドなら音楽を停止
    } else if (message.content.startsWith('!resume')) {
        resume(message, serverQueue);  // !resumeコマンドなら音楽を再開
    } else if (message.content.startsWith('!queue')) {
        showQueue(message, serverQueue); // !queueコマンドなら現在のキューを表示
    } else if (message.content.startsWith('!help')) {
        showHelp(message);               // !helpコマンドならヘルプメッセージを表示
    } else if (message.content.startsWith('!disconnect')) {
        disconnect(message, serverQueue); // !disconnectコマンドならボットを切断
    } else {
        message.channel.send('有効なコマンドを入力してください！'); // その他のコマンドはエラーメッセージを送信
    }
});

// 音楽を再生するための関数。!playコマンドが実行された時に呼び出される
async function execute(message, serverQueue) {
    // メッセージの内容をスペースで分割して配列にする（!play コマンドの後に続くYouTubeのURLや検索ワードを取得するため）
    const args = message.content.split(' ');

    // コマンドの後に引数（URLまたは検索ワード）がない場合はエラーメッセージを送信
    if (!args[1]) {
        return message.channel.send('YouTube URLまたは検索語を入力してください！');
    }

    // ユーザーが現在参加しているボイスチャンネルを取得
    const voiceChannel = message.member.voice.channel;
    if (!voiceChannel) {
        return message.channel.send('音楽を再生するにはボイスチャンネルに参加する必要があります！');
    }

    // ボットがそのボイスチャンネルに接続して話すための権限があるか確認
    const permissions = voiceChannel.permissionsFor(message.client.user);
    if (!permissions.has('Connect') || !permissions.has('Speak')) {
        return message.channel.send('ボイスチャンネルに参加して話す権限が必要です！');
    }

    try {
        let songs = [];
        // 入力されたリンクがYouTubeプレイリストか確認
        if (ytpl.validateID(args[1])) {
            // プレイリストの場合、プレイリストの全曲を取得し、キューに追加する
            const playlist = await ytpl(args[1]);
            songs = playlist.items.map(item => ({
                title: item.title,
                url: item.url,
            }));
            message.channel.send(`プレイリスト: **${playlist.title}** を追加しました（${songs.length}曲）`);
        } else {
            let songInfo;
            // 入力がYouTubeのURLなら、その曲の情報を取得
            if (ytdl.validateURL(args[1])) {
                songInfo = await ytdl.getInfo(args[1]);
            } else {
                // URLでない場合、YouTube APIを使って検索し、最初の結果を取得
                const searchQuery = args.slice(1).join(' ');
                const response = await axios.get(`https://www.googleapis.com/youtube/v3/search`, {
                    params: {
                        part: 'snippet',
                        type: 'video',
                        q: searchQuery,
                        key: youtubeApiKey,
                        maxResults: 1
                    }
                });

                if (response.data.items.length === 0) {
                    return message.channel.send('検索結果が見つかりませんでした。');
                }

                // 検索結果から動画IDを取得し、その動画の情報を取得
                const videoId = response.data.items[0].id.videoId;
                songInfo = await ytdl.getInfo(`https://www.youtube.com/watch?v=${videoId}`);
            }
            // 取得した曲情報をキューに追加
            songs.push({
                title: songInfo.videoDetails.title,
                url: songInfo.videoDetails.video_url,
            });
        }

        // サーバーに再生キューがまだ存在しない場合、新たにキューを作成
        if (!serverQueue) {
            const queueContruct = {
                textChannel: message.channel,  // 曲が再生されることを通知するテキストチャンネル
                voiceChannel: voiceChannel,    // ユーザーが接続しているボイスチャンネル
                connection: null,              // ボイスチャンネルへの接続オブジェクト
                songs: [],                     // キューに入っている曲のリスト
                volume: 5,                     // 再生音量
                playing: true,                 // 現在再生中かどうか
            };

            // サーバーのIDをキーにしてキューをセット
            queue.set(message.guild.id, queueContruct);
            queueContruct.songs = queueContruct.songs.concat(songs);

            try {
                // ボイスチャンネルに接続
                const connection = joinVoiceChannel({
                    channelId: voiceChannel.id,
                    guildId: voiceChannel.guild.id,
                    adapterCreator: voiceChannel.guild.voiceAdapterCreator,
                });
                queueContruct.connection = connection;
                
                // 接続が確立したら最初の曲を再生
                connection.on(VoiceConnectionStatus.Ready, () => {
                    console.log('接続準備完了 - 音声再生可能です！');
                    playSong(message.guild, queueContruct.songs[0]);
                });

            } catch (err) {
                // 接続に失敗した場合、エラーメッセージを出力し、キューを削除
                console.log(err);
                queue.delete(message.guild.id);
                return message.channel.send(`ボイスチャンネルに参加できませんでした: ${err.message}`);
            }
        } else {
            // 既にキューが存在する場合、曲を追加する
            serverQueue.songs = serverQueue.songs.concat(songs);
            if (songs.length === 1) {
                return message.channel.send(`${songs[0].title} がキューに追加されました！`);
            } else {
                return message.channel.send(`${songs.length} 曲がキューに追加されました！`);
            }
        }
    } catch (error) {
        // 曲の再生中にエラーが発生した場合の処理
        console.error('実行関数でエラーが発生しました:', error);
        return message.channel.send(`エラーが発生しました: ${error.message}`);
    }
}
// 現在再生中の曲をスキップする関数。!skipコマンドが実行されたときに呼び出される
function skip(message, serverQueue) {
    // ユーザーがボイスチャンネルにいない場合、エラーメッセージを送信
    if (!message.member.voice.channel) {
        return message.channel.send('音楽をスキップするにはボイスチャンネルにいる必要があります！');
    }
    // 再生キューがない場合、スキップできる曲がないためエラーメッセージを送信
    if (!serverQueue) {
        return message.channel.send('スキップする曲がありません！');
    }
    // 現在の曲をキューから削除し、次の曲を再生
    serverQueue.songs.shift();
    playSong(message.guild, serverQueue.songs[0]); // 次の曲を再生するためにplaySong関数を呼び出す
}

// 音楽を停止する関数。!stopコマンドが実行されたときに呼び出される
function stop(message, serverQueue) {
    // ユーザーがボイスチャンネルにいない場合、エラーメッセージを送信
    if (!message.member.voice.channel) {
        return message.channel.send('音楽を停止するにはボイスチャンネルにいる必要があります！');
    }
    // 再生キューがない場合、停止できる曲がないためエラーメッセージを送信
    if (!serverQueue) {
        return message.channel.send('停止する曲がありません！');
    }
    // ボイスチャンネルに接続している場合、再生を一時停止し、キューをクリアする
    if (serverQueue.connection) {
        serverQueue.connection.dispatcher.pause(); // 現在の曲を一時停止
    }
    serverQueue.playing = false; // 再生中フラグをfalseに設定
    message.channel.send('音楽を停止しました。再開するには !resume を使用してください。');
}

// 一時停止した音楽を再開する関数。!resumeコマンドが実行されたときに呼び出される
function resume(message, serverQueue) {
    // ユーザーがボイスチャンネルにいない場合、エラーメッセージを送信
    if (!message.member.voice.channel) {
        return message.channel.send('音楽を再開するにはボイスチャンネルにいる必要があります！');
    }
    // 再生キューがない場合、再開できる曲がないためエラーメッセージを送信
    if (!serverQueue) {
        return message.channel.send('再開する曲がありません！');
    }
    // 再生が一時停止していて、まだ再生中でない場合、再生を再開する
    if (serverQueue.connection && !serverQueue.playing) {
        serverQueue.connection.dispatcher.resume(); // 一時停止していた再生を再開
        serverQueue.playing = true; // 再生中フラグをtrueに設定
        message.channel.send('音楽を再開しました。');
    } else {
        message.channel.send('音楽は既に再生中です。');
    }
}

// 曲を実際に再生するための関数。キューにある曲を再生し、終了したら次の曲を再生する
async function playSong(guild, song) {
    const serverQueue = queue.get(guild.id);
    // 曲がない場合、何もせずに終了
    if (!song) {
        return;
    }

    console.log(`再生を試みています: ${song.title}`); // 再生しようとしている曲のタイトルをコンソールに出力

    try {
        // YouTubeのURLから音声ストリームを取得
        const stream = ytdl(song.url, {
            filter: 'audioonly',            // 動画から音声のみを取得
            quality: 'highestaudio',        // 最高音質を指定
            highWaterMark: 1 << 25,         // バッファサイズを大きく設定（高品質ストリームの場合に重要）
        });

        // ストリーム中にエラーが発生した場合の処理
        stream.on('error', (error) => {
            console.error('ytdlストリームでエラーが発生しました:', error);
            serverQueue.textChannel.send(`曲の再生中にエラーが発生しました: ${error.message}`);
            // エラーが発生した場合は次の曲を再生
            serverQueue.songs.shift();
            playSong(guild, serverQueue.songs[0]);
        });

        // ストリームを音声リソースとして作成
        const resource = createAudioResource(stream, { inputType: StreamType.Arbitrary });

        // 新たにオーディオプレイヤーを作成し、リソースを再生
        const player = createAudioPlayer();
        player.play(resource);

        // プレイヤーをボイスチャンネルに接続
        serverQueue.connection.subscribe(player);

        // 曲が再生されている間に発生するイベント
        player.on(AudioPlayerStatus.Playing, () => {
            console.log(`再生中: ${song.title}`);
            serverQueue.textChannel.send(`再生中: **${song.title}**`);
        });

        // 曲が終了したときに発生するイベント
        player.on(AudioPlayerStatus.Idle, () => {
            console.log(`再生終了: ${song.title}`);
            // 次の曲を再生
            serverQueue.songs.shift();
            playSong(guild, serverQueue.songs[0]);
        });

        // プレイヤーでエラーが発生した場合の処理
        player.on('error', error => {
            console.error(`${song.title} の再生中にエラーが発生しました:`, error);
            serverQueue.textChannel.send('曲の再生中にエラーが発生しました。');
            // 次の曲を再生
            serverQueue.songs.shift();
            playSong(guild, serverQueue.songs[0]);
        });

    } catch (error) {
        // 曲の再生中にエラーが発生した場合のエラーハンドリング
        console.error(`${song.title} の playSong 関数でエラーが発生しました:`, error);
        if (serverQueue) {
            serverQueue.textChannel.send('曲の再生中にエラーが発生しました。');
            // 次の曲を再生
            serverQueue.songs.shift();
            playSong(guild, serverQueue.songs[0]);
        }
    }
}

// 現在の再生キューを表示する関数。!queueコマンドが実行されたときに呼び出される
function showQueue(message, serverQueue) {
    // キューが空の場合はエラーメッセージを送信
    if (!serverQueue) {
        return message.channel.send('キューに曲がありません！');
    }

    // EmbedBuilderを使ってキューを整形して表示
    const embed = new EmbedBuilder()
        .setTitle('再生キュー') // Embedのタイトルを設定
        .setDescription(serverQueue.songs.slice(0, 10).map((song, index) => `${index + 1}. ${song.title}`).join('\n')) // キューの曲リストを表示（最大10曲）
        .setFooter({ text: `全 ${serverQueue.songs.length} 曲` }) // 全曲数をフッターに表示
        .setColor('#0099ff'); // Embedの色を設定

    message.channel.send({ embeds: [embed] }); // 整形されたキューをチャンネルに送信
}

// ボイスチャンネルからボットを切断する関数。!disconnectコマンドが実行されたときに呼び出される
function disconnect(message, serverQueue) {
    // ユーザーがボイスチャンネルにいない場合はエラーメッセージを送信
    if (!message.member.voice.channel) {
        return message.channel.send('ボットを切断するには、ボイスチャンネルにいる必要があります！');
    }
    // 再生キューがない場合はボットが接続されていないので、エラーメッセージを送信
    if (!serverQueue) {
        return message.channel.send('ボットは現在接続されていません。');
    }
    // キューをクリアし、ボイスチャンネルから切断
    serverQueue.songs = []; // キューをクリア
    if (serverQueue.connection) {
        serverQueue.connection.destroy(); // ボットをボイスチャンネルから切断
    }
    queue.delete(message.guild.id); // サーバーのキューを削除
    message.channel.send('ボイスチャンネルから切断し、キューをクリアしました。');
}

// ヘルプメッセージを表示する関数。!helpコマンドが実行されたときに呼び出される
function showHelp(message) {
    // EmbedBuilderを使ってヘルプメッセージを整形
    const embed = new EmbedBuilder()
        .setTitle('ミュージックボットコマンド') // Embedのタイトルを設定
        .setDescription('利用可能なコマンド一覧：') // Embedの説明を設定
        .addFields(
            { name: '!play <曲名/URL/プレイリストURL>', value: '曲またはプレイリストを再生またはキューに追加します' },
            { name: '!skip', value: '現在の曲をスキップします' },
            { name: '!stop', value: '音楽を一時停止します' },
            { name: '!resume', value: '一時停止した音楽を再開します' },
            { name: '!queue', value: '現在の曲のキューを表示します' },
            { name: '!disconnect', value: 'ボットをボイスチャンネルから切断し、キューをクリアします' },
            { name: '!help', value: 'このヘルプメッセージを表示します' }
        )
        .setColor('#0099ff'); // Embedの色を設定

    message.channel.send({ embeds: [embed] }); // 整形されたヘルプメッセージをチャンネルに送信
}

// Discordボットにログイン。トークンを使用してボットを認証
client.login(token);

