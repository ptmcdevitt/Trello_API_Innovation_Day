// JavaScript Document
 //common angular init shared across all pages

var app = angular.module("app", []);

angular.element(document).ready(function () {
    angular.bootstrap(document, ['app']);
});

//filters

app.filter("markdown", ["$sce", function ($sce) {
    var md = window.markdownit({
        linkify: true
    });

    return function (text) {
        var markdown = md.render(text);
        markdown = markdown.replace("<blockquote>", "<blockquote class=\"blockquote\">");
        return $sce.trustAsHtml(markdown);
    }
}]);
