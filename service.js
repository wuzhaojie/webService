var pSpace = require('pSpace');
var iconv = require('iconv-lite');
var read = require('readCsv');
var async = require('async');
var http = require('http');
var config = require('./config/config');
var express = require('express');
var cookieParser = require('cookie-parser');
var bodyParser = require('body-parser');
var logger = require('log').initLog(__dirname);
var EventEmitter = require('events').EventEmitter;
var event = new EventEmitter();
var guard = require('guard');
guard.start();

//配置app
var app = express();
app.use(bodyParser.json({ "limit": "10000kb" }));
app.use(bodyParser.urlencoded({ extended: false }));
app.use(cookieParser());

//处理client端请求
var g_res = {};
app.get('/GetNowValue', function(req, res) {
    g_res = res;
    task();
});

//配置httpServer
var server = http.createServer(app).listen(config.ListenPort, function() {
    console.info('Express app started');
    logger.warn('Express app started');
});

//输出监听端口号
function onListening() {
    var addr = server.address();
    var bind = typeof addr === 'string'
        ? 'pipe ' + addr
        : 'port ' + addr.port;
    console.info('Listening on ' + bind);
    logger.warn('Listening on ' + bind);
}
server.on('listening', onListening);

//监听'error'事件,并返回友好错误信息;
function onError(error) {
    if (error.syscall !== 'listen') {
        throw error;
    }
    var bind = typeof port === 'string'
        ? 'Pipe ' + port
        : 'Port ' + port;
    switch (error.code) {
        case 'EACCES':
            logger.error(bind + ' requires elevated privileges');
            process.exit(1);
            break;
        case 'EADDRINUSE':
            logger.error(bind + ' is already in use');
            process.exit(1);
            break;
        default:
            throw error;
    }
}
server.on('error', onError);

//连接pSapce
function psConn() {
    var res = pSpace.openConn(config.pSpace.name, config.pSpace.address, config.pSpace.user, config.pSpace.password);
    if (res.hasOwnProperty("errString")) {
        console.error("pSpace.openConn error:", res.errString);
        logger.error("pSpace.openConn error:", res.errString);
    } else {
        console.info("pSpace.openConn success.");
    }
}
psConn();

//检查pSpace是否连接
function checkPSConnect() {
    var res = pSpace.isConnected(config.pSpace.name);
    if (res.hasOwnProperty("errString")) {
        console.error("pSpace.isConnected error:", res.errString);
        logger.error("pSpace.isConnected error:", res.errString);
        psConn();
    }
}
setInterval(checkPSConnect, 1000);

//读tagRef.csv配置文件中测点信息，并填充到全局变量g_tagRef中
var g_tagRef = {};
function readFile() {
    read.readCsv(__dirname + '\\config\\tagRef.csv', function(err, confData) {
        if (err) {
            console.error("readFile error:",err);
            logger.error("readFile error:",err);
        } else {
            var pipeName, stationName, tag = {};
            for (var i in confData) {
                if (i == 0 || i == 1) {
                } else {
                    //解析管线名称
                    pipeName = new Buffer(confData[i][0], 'utf8');
                    pipeName = iconv.decode(pipeName, 'utf8');
                    if (g_tagRef[pipeName] == undefined) {
                        g_tagRef[pipeName] = {};
                    }
                    //解析站名
                    stationName = new Buffer(confData[i][1], 'utf8');
                    stationName = iconv.decode(stationName, 'utf8');
                    if (g_tagRef[pipeName][stationName] == undefined) {
                        g_tagRef[pipeName][stationName] = [];
                    }
                    //解析存储在pSpace中的测点长名
                    tag.longName = new Buffer(confData[i][2], 'utf8');
                    tag.longName = iconv.decode(tag.longName, 'utf8');
                    //解析测点类型(压力、温度、流量)
                    tag.type = new Buffer(confData[i][3], 'utf8');
                    tag.type = iconv.decode(tag.type, 'utf8');
                    g_tagRef[pipeName][stationName].push(tag);
                    tag = {};
                }
            }
            //console.log(JSON.stringify(g_tagRef));
        }
    });
}
readFile();

function readReal(cb) {
    var sendDataArr = [];
    var sendDataJson = {}, realData = {};
    for (var i in g_tagRef) {//管线
        for (var j in g_tagRef[i]) {//站
            //console.log(g_tagRef[i][j]);
            for (var k in g_tagRef[i][j])//测点
            {
                realData = pSpace.readReal('pSpace' + g_tagRef[i][j][k].longName);
                if (realData.hasOwnProperty("errString")) {
                    console.error(g_tagRef[i][j][k].longName+":"+realData.errString);
                    logger.error(g_tagRef[i][j][k].longName+":"+realData.errString);
                    sendDataJson.pipeName = i;
                    sendDataJson.stationName = j;
                    sendDataJson[g_tagRef[i][j][k].type] = realData.errString;
                } else {
                    //console.log(realData);
                    sendDataJson.pipeName = i;
                    sendDataJson.stationName = j;
                    sendDataJson[g_tagRef[i][j][k].type] = realData.value;
                }
                realData = {};
            }
            sendDataArr.push(sendDataJson);
            sendDataJson = {};
        }
    }
    cb(null, sendDataArr);
}

function task() {
    async.waterfall([
        function(cb) {
            readReal(cb);
        },
        function(sendDataArr, done) {
            var sendData = {};
            sendData.NowValue = sendDataArr;
            g_res.send(JSON.stringify(sendData));
            console.info("read success!");
            done();
        }], function(err, ret) {
            if (err) {
                console.error(err);
                logger.error(err);
            }
        });
}

guard.startError();
guard.onStop(function(err, result) {
    if (err) {
    } else {
        logger.info("收到停止信号");
        process.exit(1);
    }
});