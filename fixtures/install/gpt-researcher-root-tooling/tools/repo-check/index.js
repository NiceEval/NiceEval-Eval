const { execFileSync } = require('node:child_process');

exports.checkPython = function checkPython(path) {
  execFileSync('python3', ['-c',
    'import ast, pathlib, sys; p = pathlib.Path(sys.argv[1]); ast.parse(p.read_text(), filename=str(p)); print(str(p) + ": syntax OK")',
    path,
  ], { stdio: 'inherit' });
};
