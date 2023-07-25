const { task } = require("hardhat/config");

require("@nomicfoundation/hardhat-toolbox");

// tasks file
[
    'get-new-tokens-distribution'
]
.map(e => require(`./tasks/${e}`))
.forEach(e => task(e.name, e.description, e.callback));


/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
    solidity: {
        compilers: [
            {
                version: '0.8.9',
                settings: {
                    optimizer: {
                        enabled: true,
                        runs: 200
                    }
                }
            },
        ]                
    },
    networks: {
        hardhat: {
            forking: {
                url: process.env.MAINNET_URL,
                blockNumber: 17746148,
            }
        },
        sepolia: {
            url: process.env.NETWORK_URL,
            accounts: [`0x${process.env.DEV_PRIVATE_KEY}`]
        }
    }
};
