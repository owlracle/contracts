// THIS IS FOR CALCULATING THE EXACT AMOUNT OF TOKENS EACH HOLDER HAD AT THE TIME OF THE SNAPSHOT
// REMEMBER TO USE BLOCK 17720478 FOR THIS

async function callback() {
    let block = await ethers.provider.getBlock();
    console.log('Block number: ' + block.number);
    console.log('Block time: ' + new Date(block.timestamp * 1000).toUTCString());

    if (block.number !== 17720478) {
        console.log('Wrong block number. Please use block 17720478. Exiting...');
        return;
    }
    
    const pairAddress = '0x01D808d201c786F3Af7c80528A3a79A7325B2A4B';
    const abi = require('../files/pairABI.json');
    const pair = await ethers.getContractAt(abi, pairAddress);

    const reserves = await pair.getReserves();
    const ethReserve = reserves[0];
    console.log('ETH reserve: ' + ethers.utils.formatEther(ethReserve));
    // token uses 9 decimals
    const tokenReserve = reserves[1].mul('1000000000');
    console.log('Token reserve: ' + ethers.utils.formatEther(tokenReserve));

    // taken from holders.at
    // https://holders.at/ethereum/0x01D808d201c786F3Af7c80528A3a79A7325B2A4B/17720478
    const holders = [
        '0x663a5c229c09b049e36dcc11a9b0d4a8eb9db214', // liquidity pool
        '0x34f32585fe7eb12e266d15b23ee8a47b5bd20a42', // marketing team
        '0xaaac34d30d6938787c653aafb922bc20bfa9c512',
        '0x04bda42de3bc32abb00df46004204424d4cf8287',
    ]
    
    const totalSupply = await pair.totalSupply();
    
    const balances = await Promise.all(holders.map(async (holder) => {
        const balance = await pair.balanceOf(holder);
        let share = balance.mul('1000000').div(totalSupply);
        share = parseFloat(share) / 10000;
        let tokens = balance.mul(tokenReserve).div(totalSupply);
        tokens = ethers.utils.formatEther(tokens);
        return { holder, balance, share, tokens };
    }));

    console.log(balances);

    // RESULTS: EXCLUDING LIQUIDITY POOL AND MARKETING TEAM'S WALLET
    // '0xaaac34d30d6938787c653aafb922bc20bfa9c512','6683954.480824915598744423'
    // '0x04bda42de3bc32abb00df46004204424d4cf8287','2659730.241912068084060371'

}

module.exports = {
    name: 'pool-holders',
    description: 'Get holders from snapshot holding token inside liquidity pool.',
    callback,
};