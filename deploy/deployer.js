let returnedVars = {};

const scripts = ([
    'OwlToken',
    'addLiqudity',
    'swap',
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
