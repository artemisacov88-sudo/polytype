"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.russian = void 0;
exports.russian = {
    id: "ru",
    displayName: "Русский",
    rules: {
        tokenize(text) {
            return text.match(/[а-яё]+/giu) ?? [];
        },
        normalizeWord(word) {
            return word.toLocaleLowerCase("ru-RU").replace(/ё/g, "е");
        },
    },
};
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicnVzc2lhbi5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9sYW5ndWFnZS9tb2R1bGVzL3J1c3NpYW4udHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBR2EsUUFBQSxPQUFPLEdBQW1CO0lBQ3RDLEVBQUUsRUFBRSxJQUFJO0lBQ1IsV0FBVyxFQUFFLFNBQVM7SUFFdEIsS0FBSyxFQUFFO1FBQ04sUUFBUSxDQUFDLElBQVk7WUFDcEIsT0FBTyxJQUFJLENBQUMsS0FBSyxDQUFDLFlBQVksQ0FBQyxJQUFJLEVBQUUsQ0FBQztRQUN2QyxDQUFDO1FBRUQsYUFBYSxDQUFDLElBQVk7WUFDekIsT0FBTyxJQUFJLENBQUMsaUJBQWlCLENBQUMsT0FBTyxDQUFDLENBQUMsT0FBTyxDQUFDLElBQUksRUFBRSxHQUFHLENBQUMsQ0FBQztRQUMzRCxDQUFDO0tBQ0Q7Q0FDRCxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiXG5pbXBvcnQgdHlwZSB7IExhbmd1YWdlTW9kdWxlIH0gZnJvbSBcIi4uL3R5cGVzXCI7XG5cbmV4cG9ydCBjb25zdCBydXNzaWFuOiBMYW5ndWFnZU1vZHVsZSA9IHtcblx0aWQ6IFwicnVcIixcblx0ZGlzcGxheU5hbWU6IFwi0KDRg9GB0YHQutC40LlcIixcblxuXHRydWxlczoge1xuXHRcdHRva2VuaXplKHRleHQ6IHN0cmluZyk6IHN0cmluZ1tdIHtcblx0XHRcdHJldHVybiB0ZXh0Lm1hdGNoKC9b0LAt0Y/RkV0rL2dpdSkgPz8gW107XG5cdFx0fSxcblxuXHRcdG5vcm1hbGl6ZVdvcmQod29yZDogc3RyaW5nKTogc3RyaW5nIHtcblx0XHRcdHJldHVybiB3b3JkLnRvTG9jYWxlTG93ZXJDYXNlKFwicnUtUlVcIikucmVwbGFjZSgv0ZEvZywgXCLQtVwiKTtcblx0XHR9LFxuXHR9LFxufTtcbiJdfQ==