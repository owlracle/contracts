const { task } = require("hardhat/config");
require("hardhat-contract-sizer");


require("@nomicfoundation/hardhat-toolbox");

// tasks file
[
    'new-token-distribution',
    'liquidity-pool-holders',
    'merkle',
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
                enabled: true,
                url: 'https://eth-mainnet.g.alchemy.com/v2/' + process.env.ALCHEMY_API_KEY_MAINNET,
                // url: 'https://eth.llamarpc.com',
                // blockNumber: 17811022,
                // blockNumber: 17720478,
                // blockNumber: 17820700,
                blockNumber: 17921059,
            },
            
        },
        localhost: {
            url: 'http://localhost:8550',
        },
        mainnet: {
            url: 'https://eth-mainnet.g.alchemy.com/v2/' + process.env.ALCHEMY_API_KEY_MAINNET,
            accounts: [`0x${process.env.WALLET_PRIVATE_KEY}`],
        },
        sepolia: {
            url: 'https://eth-sepolia.g.alchemy.com/v2/' + process.env.ALCHEMY_API_KEY_SEPOLIA,
            accounts: [`0x${process.env.WALLET_PRIVATE_KEY}`]
        }
    },
    etherscan: {
        apiKey: process.env.ETHERSCAN_API_KEY
    },
};
