const { task } = require("hardhat/config");

require("@nomicfoundation/hardhat-toolbox");
require('dotenv').config();

// tasks file
[
    'fundContract',
    'getFarmInfo',
    'stakeLpIntoFarm',
    'unstakeLpFromFarm'
]
.map(e => require(`./tasks/${e}`))
.forEach(e => task(e.name, e.description, e.callback));


/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
    solidity: "0.8.9",
    networks: {
        goerli: {
            url: process.env.NETWORK_URL,
            accounts: [`0x${process.env.PRIVATE_KEY}`]
        }
    }
};
