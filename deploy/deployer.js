const network = process.env.HARDHAT_NETWORK || 'hardhat';

let returnedVars = { network };
const scripts = ([
    // 'OwlToken',
    // 'addLiqudity',
    // 'ClaimOwl',
    // 'swap',
    // 'claim',
    'OwlRouterV2',
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
