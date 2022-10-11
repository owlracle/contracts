const fs = require('fs');

let returnedVars = {};

const scripts = ([
    'OwlToken',
    'OwlFarm',
]).map(e => require(`./${e}`));

(async () => {
    for (let i in scripts) {
        returnedVars = {
            ...returnedVars,
            ...await scripts[i](returnedVars),
        };
    }

    fs.writeFileSync('./deploy/deployinfo.json', JSON.stringify(returnedVars));
})();
