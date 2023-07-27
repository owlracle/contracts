const network = process.env.HARDHAT_NETWORK || 'hardhat';

let returnedVars = {};

if (network == 'sepolia') {
    returnedVars.initialLiquidityETH = '0.01';
    returnedVars.uniswapV2RouterAddress = '0xC532a74256D3Db42D0Bf7a0400fEFDbad7694008';
    returnedVars.uniswapV2FactoryAddress = '0x7E0987E5b3a30e3f2828572Bb659A548460a3003';
}
else {
    returnedVars.initialLiquidityETH = '1';
    returnedVars.uniswapV2RouterAddress = '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D';
    returnedVars.uniswapV2FactoryAddress = '0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f';    
}

const scripts = ([
    'OwlToken',
    'addLiqudity',
    'ClaimOwl',
    'swap',
    'claim',
]).map(e => require(`./${e}`));

async function main() {
    for (let i in scripts) {
        returnedVars = {
            ...returnedVars,
            ...await scripts[i](returnedVars),
        };
    }
}
main().then(() => process.exit(0)).catch(error => {
    console.error(error);
    process.exit(1);
});
